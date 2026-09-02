/**
 * interactive/session-manager.ts — L4b Interactive / 会话生命周期
 *
 * SSOT 视角：
 *   - sessions Map<key, PiSession> 是全模块共享的会话状态
 *   - 当前架构下只会有 "p2p" 一个 session（群聊 session 已剔除）
 *   - 本模块负责 pi 子进程的 spawn / restart / NDJSON I/O / RPC 事件分发
 *   - 任务状态机由 task-state-machine.ts 拥有
 *
 * 关键不变量：
 *   - 同一 session 同一时间最多 1 个 activeTask（避免回复错位）
 *   - waitingTasks 跨 pi 重启保留（startPi 重启路径复用 pi 对象）
 *   - exit handler 释放 pendingResultFetch 句柄防 await 阻塞
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  EMOJI_ERROR,
  IS_WIN,
  PI_BIN,
  PROJECT_DIR,
} from "../config.js";
import type { PiSession } from "../shared/types.js";
import { log } from "../shared/logger.js";
import { switchReaction } from "../protocol/feishu.js";
import { completeActiveTask, finishTaskWithError, promoteNext } from "./task-state-machine.js";

// ═══════════════ 全局状态 ═══════════════

const sessions = new Map<string, PiSession>();
let eventSeq = 0;

// ═══════════════ 公共查询接口 ═══════════════

export function getPiSession(key: string): PiSession | undefined {
  return sessions.get(key);
}

/**
 * 杀掉所有 session 的 pi 子进程（cleanup 时调用）。
 * 注意：故意不删除 sessions Map 内的 PiSession 结构，仅杀 proc；
 * 进程退出 handler 会在 next tick 自我清理。
 */
export function killAllSessions(): void {
  for (const s of sessions.values()) {
    try { s.proc?.kill(); } catch {}
  }
}

// ═══════════════ seenMessageIds 清理（ingress 60s 定时器调用） ═══════════════

import { SEEN_MAX_SIZE, SEEN_TTL_MS } from "../config.js";

/**
 * seenMessageIds 清理策略：
 *   - 超过 SEEN_TTL_MS (24h) 的条目按 TTL 过期制除
 *   - 容量超 SEEN_MAX_SIZE (5000) 的按插入顺序淘汰最旧（Map 迭代顺序 = 插入顺序）
 */
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

// ═══════════════ pi RPC 启动 / 重启 ═══════════════

function startPi(sessionKey: string): void {
  const existing = sessions.get(sessionKey);

  // 已在运行：跳过
  if (existing?.proc) {
    log(`[pi:${sessionKey.slice(-12)}] 已在运行`);
    return;
  }

  let pi: PiSession;
  const sessionDir = join(PROJECT_DIR, ".pi", "sessions", `bot-${sessionKey.replace(/:/g, "-")}`);
  if (existing) {
    // 重启路径：保留 waitingTasks/seenMessageIds（activeTask/finishing 已被 exit 处理器清零）
    pi = existing;
    log(`[pi:${sessionKey.slice(-12)}] 重启（保留 waitingTasks=${pi.waitingTasks.length}, seen=${pi.seenMessageIds.size}）`);
  } else {
    // 首次启动：创建新 session
    mkdirSync(sessionDir, { recursive: true });
    pi = {
      proc: null,
      ready: false,
      activeTask: null,
      waitingTasks: [],
      seenMessageIds: new Map(),
      finishing: false,
      pendingResultFetch: null,
    };
    sessions.set(sessionKey, pi);
  }
  log(`[pi:${sessionKey.slice(-12)}] 启动...`);

  pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir], {
    cwd: PROJECT_DIR, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, LARK_BOT_RUNTIME: "1" },
    shell: IS_WIN,
  });

  pi.proc.on("error", (err) => {
    log(`[pi:${sessionKey.slice(-12)}] spawn 失败: ${err.message}（5s 后重试，保留 waitingTasks=${pi.waitingTasks.length}）`);
    pi.ready = false;
    // 与 exit handler 保持一致：保留 session，5s 后重启让 startPi 复用现有 pi
    pi.proc = null;
    setTimeout(() => startPi(sessionKey), 5000);
  });

  let buf = "";
  pi.proc.stdout?.on("data", (d: Buffer) => {
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

    // 1. activeTask → ERROR 收尾（不回复飞书：pi 已挂，网络可能也不在状态）
    if (pi.activeTask) {
      const task = pi.activeTask;
      log(`⛔ [${task.promptId}] pi 退出，activeTask 标记 ERROR (msgId=${task.msgId.slice(-8)})`);
      try { switchReaction(task, EMOJI_ERROR); } catch (e: any) {
        log(`exit 时切换 ERROR 表情失败: ${e?.message?.slice(0, 80)}`);
      }
      pi.activeTask = null;
    }

    // 2. 释放单飞句柄（让 completeActiveTask 的 await 不再阻塞）
    if (pi.pendingResultFetch) {
      try { pi.pendingResultFetch.resolve(null); } catch {}
      pi.pendingResultFetch = null;
    }

    // 3. 重置 finishing + ready
    pi.finishing = false;
    pi.ready = false;
    pi.proc = null;

    // 4. waitingTasks 保留（不删 sessions），让 get_state 就绪后补偿 promoteNext
    log(`💾 保留 waitingTasks=${pi.waitingTasks.length}, seenMessageIds=${pi.seenMessageIds.size}，5s 后重启`);

    setTimeout(() => startPi(sessionKey), 5000);
  });

  // 重启后重新探测 ready
  setTimeout(() => {
    if (pi.proc?.stdin) pi.proc.stdin.write('{"type":"get_state"}\n');
  }, 3000);
}

// ═══════════════ 启动所有 pi session ═══════════════

/**
 * 当前架构下仅启动 p2p session（唯一与 Agent 交互的入口）。
 * 群聊 session 已剔除（群聊改为广播系统）。
 */
export function startAllPi(): void {
  startPi("p2p");
}

// ═══════════════ RPC 事件分发 ═══════════════

function handlePiEvent(sessionKey: string, event: Record<string, unknown>): void {
  // R5 跨层审计：handlePiEvent 是 pi stdout 流事件处理路径，必须有 try/catch
  // 防止未知字段或协议异常拖垮整个 lark-bot 进程
  try {
    const pi = sessions.get(sessionKey);
    if (!pi) return;

    switch (event.type) {
      case "response": {
        if (event.command === "get_state" && event.success) {
          pi.ready = true;
          log(`[pi:${sessionKey.slice(-12)}] 就绪`);
          // 重启补偿：队列有任务且无 activeTask，自动晋升
          if (!pi.activeTask && pi.waitingTasks.length > 0) {
            log(`🚀 重启就绪，补偿 promoteNext (depth=${pi.waitingTasks.length})`);
            promoteNext(pi);
          }
        } else if (event.command === "prompt") {
          // prompt 投递结果：success=true 保持 THINKING 等 agent_settled；success=false 按 attemptCount 决定重试或 ERROR
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
                // 首次失败：重试，unshift 到队首保持原始顺序
                task.attemptCount++;
                pi.activeTask = null;
                pi.waitingTasks.unshift(task);
                log(`🔄 [${task.promptId}] 重试入队 (depth=${pi.waitingTasks.length})`);
                promoteNext(pi);
              } else {
                // 二次失败：放弃
                finishTaskWithError(pi, task, "prompt 被拒绝");
              }
            }
          }
        } else if (event.command === "get_last_assistant_text") {
          // 单飞取文本响应：按 id 匹配（若响应未回显 id，按单飞规则用 pendingResultFetch）
          if (pi.pendingResultFetch && pi.finishing) {
            const fetch = pi.pendingResultFetch;
            const text = (event as any).data?.text ?? null;
            const id = (event as any).id;
            if (id === undefined || id === fetch.expectedId) {
              log(`📥 [${fetch.task.promptId}] 收到 get_last_assistant_text id=${id ?? "(无)"} text.len=${text?.length ?? 0}`);
              fetch.resolve(text);
              // 保留 pi.pendingResultFetch，由 completeActiveTask 在 await 返回后清理
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
        // agent_end 不再被消费，仅记录诊断信息（含 willRetry）
        const willRetry = (event as any).willRetry;
        const task = pi.activeTask;
        log(`🔚 agent_end promptId=${task?.promptId ?? "?"} msgId=${task?.msgId?.slice(-8) ?? "?"} willRetry=${willRetry}（不消费、不回复、不晋升）`);
        break;
      }
      case "agent_settled": {
        // agent_settled = Agent 真正完成，发起 completeActiveTask
        const task = pi.activeTask;
        if (!task) {
          log(`⚠ agent_settled 但 activeTask 为空`);
          break;
        }
        log(`🏁 agent_settled promptId=${task.promptId} msgId=${task.msgId.slice(-8)}，开始 completeActiveTask`);
        // 不 await：响应处理是同步路径，完成是异步后台运行
        completeActiveTask(pi).catch((e) => log(`💥 completeActiveTask 异常: promptId=${task.promptId} err=${e?.message?.slice(0, 200)}`));
        break;
      }
    }
  } catch (e: any) {
    log(`💥 [handlePiEvent] 异常: sessionKey=${sessionKey} event.type=${(event as any)?.type} err=${e?.message?.slice(0, 200)}`);
  }
}

// ═══════════════ 公共查询接口（ingress 用） ═══════════════

/** 给 ingress 调用以分配 promptId */
export function nextPromptId(msgId: string): string {
  return `f-${++eventSeq}-${msgId.slice(-8)}`;
}

/** 检查 session 是否处于 ready 状态（ingress 决策用） */
export function isSessionReady(key: string): boolean {
  const pi = sessions.get(key);
  return pi?.ready === true;
}

/** 把消息 ID 写入 session 级 dedup 表（ingress.handleLarkEvent 调用） */
export function markSeen(pi: PiSession, msgId: string): void {
  pi.seenMessageIds.set(msgId, Date.now());
}

/** 检查消息是否已被 dedup 表记录（ingress.handleLarkEvent 调用） */
export function hasSeen(pi: PiSession, msgId: string): boolean {
  return pi.seenMessageIds.has(msgId);
}
