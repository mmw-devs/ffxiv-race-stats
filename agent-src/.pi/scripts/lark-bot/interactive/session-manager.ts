/**
 * interactive/session-manager.ts — L4b Interactive / 会话生命周期
 *
 * SSOT 视角：
 *   - sessions Map<key, PiSession> 是全模块共享的会话状态
 *   - 当前架构下 per-p2p session：每个 chat_id 独立 pi 子进程 + 任务队列 + Agent 上下文
 *   - 群聊 session 已剔除（群聊=广播，未来 broadcast 子系统接入）
 *   - 本模块负责 pi 子进程的 spawn / restart / NDJSON I/O / RPC 事件分发 / 空闲淘汰
 *   - 任务状态机由 task-state-machine.ts 拥有
 *
 * 关键不变量：
 *   - 同一 session 同一时间最多 1 个 activeTask（避免回复错位）
 *   - waitingTasks 跨 pi 重启保留（startPi 重启路径复用 pi 对象）
 *   - exit handler 释放 pendingResultFetch 句柄防 await 阻塞
 *
 * Commit 4 引入的多 session 管理：
 *   - ensureSession(key, chatId) 懒启动：首次消息触发 pi spawn，spawn mutex 防并发
 *   - 每 session 独立 lastActivityAt，空闲 IDLE_SESSION_TIMEOUT_MS 后被淘汰
 *   - sessions.size 上限 MAX_SESSIONS，超出按 LRU 淘汰最久未活动
 *   - pi 重启风暴防护（盲区 #1）天然 per-session 化（每个 key 独立计数）
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  EMOJI_ERROR,
  IDLE_SESSION_TIMEOUT_MS,
  IS_WIN,
  LOG_FILE,
  MAX_SESSIONS,
  PI_BIN,
  PI_RESTART_HISTORY_FILE,
  PI_RESTART_MAX,
  PI_RESTART_WINDOW_MS,
  PROJECT_DIR,
  SEEN_MAX_SIZE,
  SEEN_TTL_MS,
} from "../config.js";
import type { PiSession } from "../shared/types.js";
import { log } from "../shared/logger.js";
import { emitTaskJournal } from "../shared/logger.js";
import { switchReaction } from "../protocol/feishu.js";
import { completeActiveTask, finishTaskWithError, promoteNext } from "./task-state-machine.js";

// ═══════════════ 全局状态 ═══════════════

const sessions = new Map<string, PiSession>();
let eventSeq = 0;

// ═══════════════ spawn mutex（commit 4 缓解 N2：懒启动竞态） ═══════════════

/**
 * per-sessionKey 的 spawn Promise 链。
 * 同一 key 的并发 ensureSession() 调用会 await 同一 Promise，避免重复 spawn。
 * spawn 完成后清理 entry，避免内存泄漏。
 */
const spawnPromises = new Map<string, Promise<PiSession>>();

/** 标记 session 活跃（更新 lastActivityAt，用于空闲淘汰判断） */
export function markActive(pi: PiSession): void {
  pi.lastActivityAt = Date.now();
}

/**
 * 确保 session 存在。若不存在则懒启动 pi 子进程。
 *
 * 行为：
 *   - 同步快路径：session 已存在 → 直接返回
 *   - 异步慢路径：session 不存在 → spawn mutex 串行化，spawn pi 并返回新 session
 *
 * 调用方保证：
 *   - 入站事件流（ingress.handleLarkEvent）调用此函数得到 pi
 *   - 即使 pi.ready=false（刚 spawn 完），任务也直接入队；get_state 响应后自动 promoteNext
 *   - 不需要额外 isSessionReady 检查（commit 4 移除该检查）
 */
export async function ensureSession(sessionKey: string, chatId: string): Promise<PiSession> {
  // 快路径：session 已存在
  const existing = sessions.get(sessionKey);
  if (existing) {
    markActive(existing);
    return existing;
  }

  // 慢路径：可能有其他调用方正在 spawn
  const pending = spawnPromises.get(sessionKey);
  if (pending) return pending;

  // 创建 spawn Promise
  const promise = (async (): Promise<PiSession> => {
    // 二次检查（另一个调用方可能已创建好）
    const recheck = sessions.get(sessionKey);
    if (recheck) return recheck;

    // 检查全局 session 数量上限，超出则先淘汰最久未活动的
    enforceSessionLimit();

    // 创建 PiSession struct + 启动 pi
    const pi = createPiSession(sessionKey, chatId);
    sessions.set(sessionKey, pi);
    markActive(pi);
    log(`📦 [${sessionKey.slice(-12)}] 新建 session (chatId=${chatId.slice(-12)})`);
    spawnPiProcess(sessionKey);
    return pi;
  })();

  spawnPromises.set(sessionKey, promise);
  try {
    return await promise;
  } finally {
    if (spawnPromises.get(sessionKey) === promise) {
      spawnPromises.delete(sessionKey);
    }
  }
}

function createPiSession(key: string, chatId: string): PiSession {
  const sessionDir = join(PROJECT_DIR, ".pi", "sessions", `bot-${key.replace(/:/g, "-")}`);
  mkdirSync(sessionDir, { recursive: true });
  return {
    key,
    chatId,
    lastActivityAt: Date.now(),
    proc: null,
    ready: false,
    activeTask: null,
    waitingTasks: [],
    seenMessageIds: new Map(),
    finishing: false,
    pendingResultFetch: null,
  };
}

// ═══════════════ pi 重启风暴防护（盲区 #1） ═══════════════

interface PiRestartState {
  timestamps: number[];
  permanentlyDead: boolean;
  deathReason: string;
}
const piRestartState = new Map<string, PiRestartState>();

function recordPiRestart(sessionKey: string): PiRestartState {
  const now = Date.now();
  const windowStart = now - PI_RESTART_WINDOW_MS;
  let state = piRestartState.get(sessionKey);
  if (!state) {
    state = { timestamps: [], permanentlyDead: false, deathReason: "" };
    piRestartState.set(sessionKey, state);
  }
  state.timestamps = state.timestamps.filter(ts => ts >= windowStart);
  state.timestamps.push(now);

  try {
    const line = `[${new Date(now).toISOString()}] ${sessionKey} restart #${state.timestamps.length}\n`;
    appendFileSync(PI_RESTART_HISTORY_FILE, line);
  } catch {}

  if (state.timestamps.length >= PI_RESTART_MAX) {
    state.permanentlyDead = true;
    state.deathReason = `PI_RESTART_MAX=${PI_RESTART_MAX} reached in ${PI_RESTART_WINDOW_MS}ms`;
    const msg = `🛑 [${sessionKey}] pi 重启风暴：${PI_RESTART_WINDOW_MS / 1000}s 内 ${state.timestamps.length} 次 > ${PI_RESTART_MAX}, 停止重试。原因：${state.deathReason}。请人工检查 pi 二进制与 stdin 协议。`;
    log(msg);
    try {
      appendFileSync(LOG_FILE, `[${new Date(now).toISOString()}] ${msg}\n`);
    } catch {}
  }
  return state;
}

export function isPiSessionPermanentlyDead(sessionKey: string): boolean {
  return piRestartState.get(sessionKey)?.permanentlyDead === true;
}

export function getPiRestartStats(): Array<{ sessionKey: string; recent: number; dead: boolean; reason: string }> {
  const now = Date.now();
  const windowStart = now - PI_RESTART_WINDOW_MS;
  return Array.from(piRestartState.entries()).map(([key, s]) => ({
    sessionKey: key,
    recent: s.timestamps.filter(ts => ts >= windowStart).length,
    dead: s.permanentlyDead,
    reason: s.deathReason,
  }));
}

// ═══════════════ 公共查询接口 ═══════════════

/** 取已存在的 session（不触发 spawn）— 用于 backend / 心跳报告 */
export function getPiSession(key: string): PiSession | undefined {
  const pi = sessions.get(key);
  if (pi) markActive(pi);
  return pi;
}

/** 列出所有 session 的快照（心跳报告用） */
export function getAllSessions(): PiSession[] {
  const now = Date.now();
  return [...sessions.values()].map(pi => ({
    ...pi,
    lastActivityAt: pi.lastActivityAt,
    idleMs: now - pi.lastActivityAt,
  } as PiSession & { idleMs: number }));
}

/** 杀掉所有 session 的 pi 子进程（cleanup 时调用） */
export function killAllSessions(): void {
  for (const s of sessions.values()) {
    try { s.proc?.kill(); } catch {}
  }
}

// ═══════════════ seenMessageIds 清理 ═══════════════

export function cleanupSeenMessageIds(): { evictedTtl: number; evictedLru: number; remaining: number } {
  const now = Date.now();
  let evictedTtl = 0;
  let evictedLru = 0;
  for (const pi of sessions.values()) {
    for (const [msgId, addedAt] of pi.seenMessageIds) {
      if (now - addedAt > SEEN_TTL_MS) { pi.seenMessageIds.delete(msgId); evictedTtl++; }
    }
    while (pi.seenMessageIds.size > SEEN_MAX_SIZE) {
      const oldest = pi.seenMessageIds.keys().next().value;
      if (oldest === undefined) break;
      pi.seenMessageIds.delete(oldest);
      evictedLru++;
    }
  }
  const remaining = [...sessions.values()].reduce((s, p) => s + p.seenMessageIds.size, 0);
  return { evictedTtl, evictedLru, remaining };
}

// ═══════════════ 空闲淘汰 + 数量上限（commit 4 缓解 N3/N4/N5） ═══════════════

/**
 * 销毁一个 session：杀 pi 子进程 + 从 Map 移除。
 * 故意保留 sessionDir（保留 Agent 历史对话），下次该 chat_id 来消息时重建 session
 * 自动加载历史。
 *
 * 注意：不重置 piRestartState——重启风暴计数器是 per-sessionKey 的，
 * 重建 session 时会读到之前的累积重启次数。
 */
function evictSession(key: string, reason: string): void {
  const pi = sessions.get(key);
  if (!pi) return;
  log(`🗑️ [${key.slice(-12)}] session 淘汰: ${reason}`);
  try { pi.proc?.kill(); } catch {}
  sessions.delete(key);
}

/**
 * 淘汰所有空闲超时的 session。
 * 空闲定义：activeTask 为空 + waitingTasks 为空 + 上次活动超过阈值。
 * 有任务时不淘汰——避免清空正在等待的任务。
 */
export function evictIdleSessions(): { evicted: number } {
  const now = Date.now();
  const threshold = now - IDLE_SESSION_TIMEOUT_MS;
  let evicted = 0;
  for (const [key, pi] of sessions.entries()) {
    if (pi.activeTask || pi.waitingTasks.length > 0) continue;
    if (pi.lastActivityAt < threshold) {
      evictSession(key, `idle ${Math.round((now - pi.lastActivityAt) / 1000)}s`);
      evicted++;
    }
  }
  return { evicted };
}

/**
 * 当 sessions.size > MAX_SESSIONS 时，按 LRU 淘汰最久未活动的 session。
 * 与 evictIdleSessions 的区别：本函数只关心数量上限，不看是否空闲。
 */
export function enforceSessionLimit(): { evicted: number } {
  if (sessions.size <= MAX_SESSIONS) return { evicted: 0 };

  // 按 lastActivityAt 升序排序（最旧的在前）
  const sorted = [...sessions.entries()].sort((a, b) =>
    a[1].lastActivityAt - b[1].lastActivityAt,
  );

  let evicted = 0;
  const target = sessions.size - MAX_SESSIONS;
  for (let i = 0; i < target; i++) {
    const [key, pi] = sorted[i];
    if (pi.activeTask || pi.waitingTasks.length > 0) continue; // 跳过有任务的
    evictSession(key, `LRU limit (${sessions.size} > ${MAX_SESSIONS})`);
    evicted++;
  }
  return { evicted };
}

// ═══════════════ pi RPC spawn / restart ═══════════════

/**
 * 给定已存在的 session，重新 spawn pi 子进程。
 * 不创建新 session——ensureSession() 已经负责创建。
 */
function spawnPiProcess(sessionKey: string): void {
  if (isPiSessionPermanentlyDead(sessionKey)) {
    log(`🛑 [pi:${sessionKey.slice(-12)}] 已永久死亡（重启风暴），拒绝启动`);
    return;
  }

  const pi = sessions.get(sessionKey);
  if (!pi) {
    log(`⚠️ [${sessionKey.slice(-12)}] spawnPiProcess: session 不存在`);
    return;
  }
  if (pi.proc) {
    log(`[pi:${sessionKey.slice(-12)}] 已在运行`);
    return;
  }

  const sessionDir = join(PROJECT_DIR, ".pi", "sessions", `bot-${sessionKey.replace(/:/g, "-")}`);
  markActive(pi);
  log(`[pi:${sessionKey.slice(-12)}] 启动...`);

  pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir], {
    cwd: PROJECT_DIR, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, LARK_BOT_RUNTIME: "1" },
    shell: IS_WIN,
  });

  pi.proc.on("error", (err) => {
    log(`[pi:${sessionKey.slice(-12)}] spawn 失败: ${err.message}（5s 后重试，保留 waitingTasks=${pi.waitingTasks.length}）`);
    pi.ready = false;
    pi.proc = null;
    const restartState = recordPiRestart(sessionKey);
    if (restartState.permanentlyDead) {
      log(`🛑 [pi:${sessionKey.slice(-12)}] 重启风暴已触发，不再重试`);
      return;
    }
    setTimeout(() => spawnPiProcess(sessionKey), 5000);
  });

  let buf = "";
  pi.proc.stdout?.on("data", (d: Buffer) => {
    markActive(pi);
    buf += d.toString("utf-8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try { handlePiEvent(sessionKey, JSON.parse(line)); } catch {}
    }
  });

  pi.proc.stderr?.on("data", (d: Buffer) => {
    log(`[pi:${sessionKey.slice(-12)} stderr] ${d.toString("utf-8").trim().slice(0, 100)}`);
  });

  pi.proc.on("exit", (code) => {
    log(`[pi:${sessionKey.slice(-12)}] 退出 code=${code}`);

    if (pi.activeTask) {
      const task = pi.activeTask;
      log(`⛔ [${task.promptId}] pi 退出，activeTask 标记 ERROR (msgId=${task.msgId.slice(-8)})`);
      try { switchReaction(task, EMOJI_ERROR); } catch (e: any) {
        log(`exit 时切换 ERROR 表情失败: ${e?.message?.slice(0, 80)}`);
      }
      // Task journal: aborted（pi 进程意外退出）
      const durationMs = Date.now() - new Date(task.createTime).getTime();
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: task.promptId,
        operator: task.operator,
        operatorName: task.operatorName,
        outcome: "aborted",
        durationMs,
        reason: `pi_exit_code_${code ?? "unknown"}`,
      });
      pi.activeTask = null;
    }

    if (pi.pendingResultFetch) {
      try { pi.pendingResultFetch.resolve(null); } catch {}
      pi.pendingResultFetch = null;
    }

    pi.finishing = false;
    pi.ready = false;
    pi.proc = null;

    log(`💾 保留 waitingTasks=${pi.waitingTasks.length}, seenMessageIds=${pi.seenMessageIds.size}`);

    const restartState = recordPiRestart(sessionKey);
    if (restartState.permanentlyDead) {
      log(`🛑 [pi:${sessionKey.slice(-12)}] 重启风暴已触发，不再重试`);
      return;
    }
    setTimeout(() => spawnPiProcess(sessionKey), 5000);
  });

  // 重启后重新探测 ready
  setTimeout(() => {
    if (pi.proc?.stdin) pi.proc.stdin.write('{"type":"get_state"}\n');
  }, 3000);
}

// ═══════════════ 启动所有 pi session ═══════════════

/**
 * commit 4 修订：启动期不再预创建任何 p2p session。
 * 所有 session 由首次飞书消息触发懒启动（ensureSession）。
 *
 * 函数保留作为空操作，避免 main.ts 调用方的改动。
 */
export function startAllPi(): void {
  // 故意为空：per-p2p session 由 ingress.handleLarkEvent → ensureSession 懒启动
}

// ═══════════════ RPC 事件分发 ═══════════════

function handlePiEvent(sessionKey: string, event: Record<string, unknown>): void {
  try {
    const pi = sessions.get(sessionKey);
    if (!pi) return;
    markActive(pi);

    switch (event.type) {
      case "response": {
        if (event.command === "get_state" && event.success) {
          pi.ready = true;
          log(`[pi:${sessionKey.slice(-12)}] 就绪`);
          if (!pi.activeTask && pi.waitingTasks.length > 0) {
            log(`🚀 重启就绪，补偿 promoteNext (depth=${pi.waitingTasks.length})`);
            promoteNext(pi);
          }
        } else if (event.command === "prompt") {
          const id = (event as any).id as string | undefined;
          if (!pi.activeTask) {
            log(`⚠ [${sessionKey.slice(-12)}] prompt 响应但 activeTask 为空: id=${id ?? "?"}`);
          } else if (pi.activeTask.promptId !== id) {
            log(`⚠ [${sessionKey.slice(-12)}] prompt id 不匹配: 期望=${pi.activeTask.promptId} 收到=${id ?? "?"}`);
          } else {
            const task = pi.activeTask;
            if (event.success) {
              log(`✅ prompt 接受 promptId=${task.promptId} msgId=${task.msgId.slice(-8)} attempt=${task.attemptCount}，等待 agent_settled`);
            } else {
              log(`❌ prompt 拒绝 promptId=${task.promptId} msgId=${task.msgId.slice(-8)} attempt=${task.attemptCount}`);
              if (task.attemptCount === 0) {
                task.attemptCount++;
                pi.activeTask = null;
                pi.waitingTasks.unshift(task);
                log(`🔄 [${task.promptId}] 重试入队 (depth=${pi.waitingTasks.length})`);
                promoteNext(pi);
              } else {
                finishTaskWithError(pi, task, "prompt 被拒绝");
              }
            }
          }
        } else if (event.command === "get_last_assistant_text") {
          if (pi.pendingResultFetch && pi.finishing) {
            const fetch = pi.pendingResultFetch;
            const text = (event as any).data?.text ?? null;
            const id = (event as any).id;
            if (id === undefined || id === fetch.expectedId) {
              log(`📥 [${fetch.task.promptId}] 收到 get_last_assistant_text id=${id ?? "(无)"} text.len=${text?.length ?? 0}`);
              fetch.resolve(text);
            } else {
              log(`⚠ get_last_assistant_text id 不匹配: 期望=${fetch.expectedId} 收到=${id}`);
            }
          } else {
            log(`⚠ 收到 get_last_assistant_text 但无 pendingResultFetch（已超时/已清理）`);
          }
        }
        break;
      }
      case "agent_end": {
        const willRetry = (event as any).willRetry;
        const task = pi.activeTask;
        log(`🔚 agent_end promptId=${task?.promptId ?? "?"} msgId=${task?.msgId?.slice(-8) ?? "?"} willRetry=${willRetry}（不消费、不回复、不晋升）`);
        break;
      }
      case "agent_settled": {
        const task = pi.activeTask;
        if (!task) {
          log(`⚠ agent_settled 但 activeTask 为空`);
          break;
        }
        log(`🏁 agent_settled promptId=${task.promptId} msgId=${task.msgId.slice(-8)}，开始 completeActiveTask`);
        completeActiveTask(pi).catch((e) => log(`💥 completeActiveTask 异常: promptId=${task.promptId} err=${e?.message?.slice(0, 200)}`));
        break;
      }
    }
  } catch (e: any) {
    log(`💥 [handlePiEvent] 异常: sessionKey=${sessionKey} event.type=${(event as any)?.type} err=${e?.message?.slice(0, 200)}`);
  }
}

// ═══════════════ 公共查询接口（ingress 用） ═══════════════

export function nextPromptId(msgId: string): string {
  return `f-${++eventSeq}-${msgId.slice(-8)}`;
}

/** 把消息 ID 写入 session 级 dedup 表（ingress.handleLarkEvent 调用） */
export function markSeen(pi: PiSession, msgId: string): void {
  pi.seenMessageIds.set(msgId, Date.now());
}

/** 检查消息是否已被 dedup 表记录（ingress.handleLarkEvent 调用） */
export function hasSeen(pi: PiSession, msgId: string): boolean {
  return pi.seenMessageIds.has(msgId);
}
