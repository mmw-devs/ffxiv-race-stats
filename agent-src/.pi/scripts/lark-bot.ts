/**
 * lark-bot.ts — 飞书 Bot（多 pi RPC 多会话架构）
 *
 * 架构：
 *   lark-cli event consume → 会话路由 → pi RPC（每会话一个）
 *
 * 会话隔离：
 *   私聊 → p2p session（共享）
 *   群聊 → group:<chat_id> session（独立）
 *
 * 用法:  tsx lark-bot.ts
 */

import { spawn, ChildProcess, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, appendFileSync, statSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TaskStore } from "../extensions/ops-base/runtime/task-store.js";
import { LarkTaskRouter } from "../extensions/ops-base/runtime/lark-task-router.js";
import { TaskEndService } from "../extensions/ops-base/runtime/task-end-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, "..", "..");
const CLI = join(PROJECT_DIR, ".pi/npm/node_modules/@larksuite/cli/bin/lark-cli");
const PID_FILE = join(tmpdir(), "lark-bot.pid");
const LOG_FILE = join(tmpdir(), "lark-bot.log");

// ═══════════════ 日志轮转与会话保留 ═══════════════
const LOG_MAX_BYTES = 50 * 1024 * 1024;
const LOG_KEEP_BACKUPS = 5;
const SESSION_MAX_AGE_DAYS = 30;
const SESSION_KEEP_PER_CHAT = 5;
const SESSION_ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;
const PI_BIN = process.env.PI_BIN || "pi";
const IS_WIN = process.platform === "win32";

const BOT_OPEN_ID = process.env.LARK_BOT_OPEN_ID || "ou_f284b18bf12c193bf5a942a273c5cbf0";
const BOT_NAME = process.env.LARK_BOT_NAME || "FFXIV 竞速";

// ═══════════════ 代理 ═══════════════
if (!process.env.HTTP_PROXY) {
  try {
    const s = JSON.parse(readFileSync(join(PROJECT_DIR, ".pi/settings.json"), "utf-8"));
    if (s.proxy) { process.env.HTTP_PROXY = s.proxy; process.env.HTTPS_PROXY = s.proxy; }
  } catch {}
}

// ═══════════════ 日志 ═══════════════
function log(msg: string) {
  // 完整 ISO 8601（带日期）便于跨天、跨服务排查
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    rotateLogIfNeeded();
    appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const stats = statSync(LOG_FILE);
    if (stats.size < LOG_MAX_BYTES) return;
    try { unlinkSync(`${LOG_FILE}.${LOG_KEEP_BACKUPS}`); } catch {}
    for (let i = LOG_KEEP_BACKUPS - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      try { if (existsSync(src)) renameSync(src, dst); } catch {}
    }
    try { renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch {}
  } catch {}
}

// ═══════════════ 进程存活检测 ═══════════════
/** Windows: tasklist /FO CSV /NH → 解析第二列 PID；非 Windows: process.kill(pid, 0) */
function isAlive(pid: number): boolean {
  if (IS_WIN) {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
        encoding: "utf-8",
      });
      for (const line of out.trim().split("\n")) {
        // CSV 格式: "进程名","PID","会话名","会话#","内存使用"
        const cols = line.match(/"([^"]*)"/g);
        if (cols && cols.length >= 2 && cols[1].replace(/"/g, "") === String(pid)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ═══════════════ 表情 ═══════════════
const EMOJI_READ = "WAVE";
const EMOJI_WAITING = "OnIt";
const EMOJI_THINKING = "THINKING";
const EMOJI_DONE = "DONE";
const EMOJI_ERROR = "ERROR";

/** 任务对象最小可见字段（switchReaction 只用到这两个） */
interface TaskReactionView {
  msgId: string;
  reactionId: string | null;
}

function addReaction(msgId: string, emoji: string): string | null {
  try {
    const params = JSON.stringify({ message_id: msgId });
    const data = JSON.stringify({ reaction_type: { emoji_type: emoji } });
    const out = execSync(
      `"${CLI}" im reactions create --as bot --params '${params}' --data '${data}'`,
      { timeout: 5000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return JSON.parse(out).data?.reaction_id ?? null;
  } catch { return null; }
}

function delReaction(msgId: string, reactionId: string): void {
  if (!reactionId) return;
  const params = JSON.stringify({ message_id: msgId, reaction_id: reactionId });
  try { execSync(`"${CLI}" im reactions delete --as bot --params '${params}'`, { timeout: 5000, encoding: "utf-8", stdio: "ignore" }); } catch {}
}

/**
 * 统一切换任务的表情：
 *   1. 先 addReaction 拿新 reactionId（保证切换顺序：旧→新）
 *   2. 成功后才 delReaction 旧的，避免新表情未生效前先移除旧表情
 *   3. 失败只记日志，不阻断业务流程（表情失败仅影响视觉）
 *
 * 调用方需把返回的 reactionId 写回 task.reactionId，便于下次切换。
 */
function switchReaction(task: TaskReactionView, emoji: string): string | null {
  const newId = addReaction(task.msgId, emoji);
  if (!newId) {
    log(`表情切换失败: msgId=${task.msgId.slice(-8)} emoji=${emoji}`);
    return task.reactionId;
  }
  delReaction(task.msgId, task.reactionId ?? "");
  task.reactionId = newId;
  return newId;
}

// ═══════════════ 飞书回复 ═══════════════
/** 飞书回复内置超时（在该时间内拿不到 message_id 则认为失败） */
const REPLY_SEND_TIMEOUT_MS = 18_000;

/** sendReplyGetId 结构化返回：不重试、不重发，失败走 ERROR */
interface SendReplyResult {
  ok: boolean;             // true = 拿到 replyId；false = 超时/解析失败/spawn 错误
  replyId: string | null;  // 成功时为飞书 message_id
  error?: string;          // 详细错误信息（仅 ok=false 时设）
  timedOut?: boolean;      // true = 超时（与 error 并存或单独存在）
}

function sendReply(msgId: string, text: string, replyInThread = false): void {
  const args = ["im", "+messages-reply", "--as", "bot", "--message-id", msgId, "--text", text];
  if (replyInThread) args.push("--reply-in-thread");
  spawn(CLI, args, { stdio: "ignore" }).on("error", (e) => log(`reply fire-and-forget 失败: msgId=${msgId.slice(-8)} err=${e.message}`));
}

/**
 * 飞书回复并获取新消息 ID。
 *   - 内置超时（REPLY_SEND_TIMEOUT_MS）：超时后 kill 子进程，结果不明确走 ERROR
 *   - 响应解析失败：走 ERROR（不猜测）
 *   - 拿不到 replyId：走 ERROR（不重发）
 *   - 一律不重试：调用方根据 ok 决定 DONE/ERROR
 */
function sendReplyGetId(msgId: string, text: string, replyInThread = false): Promise<SendReplyResult> {
  return new Promise((resolve) => {
    const args = ["im", "+messages-reply", "--as", "bot", "--message-id", msgId, "--text", text, "--format", "json"];
    if (replyInThread) args.push("--reply-in-thread");

    let out = "";
    let settled = false;

    const finish = (r: SendReplyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      // 超时：拿不到结果不猜测，kill 子进程防泄漏
      try { p.kill("SIGKILL"); } catch {}
      finish({ ok: false, replyId: null, error: `timeout after ${REPLY_SEND_TIMEOUT_MS}ms`, timedOut: true });
    }, REPLY_SEND_TIMEOUT_MS);

    const p = spawn(CLI, args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout?.on("data", (d: Buffer) => { out += d.toString("utf-8"); });
    p.on("close", (code) => {
      if (settled) return; // 已超时结算
      let parsed: any = null;
      try { parsed = JSON.parse(out); } catch {}
      const replyId = parsed?.data?.message_id;
      if (replyId && typeof replyId === "string") {
        finish({ ok: true, replyId });
      } else {
        const err = parsed?.msg || parsed?.error || `exit code=${code}, no message_id, stdout=${out.slice(0, 200)}`;
        finish({ ok: false, replyId: null, error: String(err) });
      }
    });
    p.on("error", (e) => {
      finish({ ok: false, replyId: null, error: `spawn error: ${e.message}` });
    });
  });
}

// ═══════════════ 飞书事件类型 ═══════════════
interface LarkEvent {
  type: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  sender_id: string;
  message_id: string;
  message_type: string;
  content: string;
  create_time: string;
  mentions?: Array<{ key: string; name: string; id?: string }>;
  thread_id?: string;
  root_id?: string;
}

function isMentioned(event: LarkEvent): boolean {
  for (const m of event.mentions ?? []) {
    if (m.id === BOT_OPEN_ID || m.name === BOT_NAME) return true;
  }
  return false;
}

function stripMention(content: string): string {
  const cleaned = content.replace(new RegExp(`^@${BOT_NAME}\\s+`, "i"), "").replace(/^@\\S+\\s+/, "").trim();
  return cleaned || content.trim();
}

// ═══════════════ 话题活跃 ═══════════════
const activeThreads = new Map<string, number>();
const THREAD_TTL_MS = 30 * 60 * 1000;
const seedMessages = new Set<string>();

// 步骤 11：seenMessageIds 清理策略
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;  // 24h 过期
const SEEN_MAX_SIZE = 5000;               // 容量上限

function activateThread(tid: string) { activeThreads.set(tid, Date.now()); }
function isThreadActive(tid: string) { return activeThreads.has(tid); }
function threadKey(e: LarkEvent): string | null { return e.thread_id || e.root_id || null; }

setInterval(() => {
  const now = Date.now();
  for (const [tid, last] of activeThreads) { if (now - last > THREAD_TTL_MS) activeThreads.delete(tid); }
  if (seedMessages.size > 100) seedMessages.clear();

  // 步骤 11：seenMessageIds 清理
  //   - TTL 超过 24h 的过期条目制除
  //   - 容量超 5000 的按插入顺序淘汰最旧（Map 迭代顺序 = 插入顺序）
  for (const pi of sessions.values()) {
    let evictedTtl = 0;
    for (const [msgId, addedAt] of pi.seenMessageIds) {
      if (now - addedAt > SEEN_TTL_MS) { pi.seenMessageIds.delete(msgId); evictedTtl++; }
    }
    let evictedLru = 0;
    while (pi.seenMessageIds.size > SEEN_MAX_SIZE) {
      const oldest = pi.seenMessageIds.keys().next().value;
      if (oldest === undefined) break;
      pi.seenMessageIds.delete(oldest);
      evictedLru++;
    }
    if (evictedTtl > 0 || evictedLru > 0) {
      log(`🧹 [seenMessageIds 清理] ttl=${evictedTtl} lru=${evictedLru} 剩=${pi.seenMessageIds.size}`);
    }
  }
}, 60_000);

// ═══════════════ 话题轮询 ═══════════════
const polledMsgIds = new Set<string>();
const knownChatIds = new Set<string>();

async function pollActiveThreads(): Promise<void> {
  if (knownChatIds.size === 0) return;
  for (const chatId of knownChatIds) {
    try {
      const out = execSync(
        `"${CLI}" im +chat-messages-list --as bot --chat-id "${chatId}" --order desc --page-size 5 --format json`,
        { timeout: 8000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
      );
      const items = JSON.parse(out).data?.items || [];
      for (const msg of items) {
        if (!msg.message_id || polledMsgIds.has(msg.message_id)) continue;
        polledMsgIds.add(msg.message_id);
        if (msg.msg_type !== "text") continue;
        const tid = msg.thread_id || msg.root_id || null;
        if (!tid) continue;
        const content = msg.body?.content || "";
        const mentioned = content.includes(`@${BOT_NAME}`);
        if (mentioned) activateThread(tid);
        else if (!isThreadActive(tid)) continue;
        void handleLarkEvent({
          type: "im.message.receive_v1", chat_id: chatId, chat_type: "group",
          sender_id: msg.sender?.id || "unknown", message_id: msg.message_id,
          message_type: "text", content, create_time: msg.create_time || "",
          thread_id: tid, root_id: msg.root_id,
        }, "poll").catch((error) => log(`poll task 路由异常: ${error?.message?.slice(0, 160)}`));
      }
    } catch {}
  }
}
setInterval(pollActiveThreads, 5000);

// ═══════════════ 会话路由 ═══════════════
function sessionKey(event: LarkEvent): string {
  if (event.chat_type === "p2p") return "p2p";
  return `group:${event.chat_id}`;
}

function shouldHandle(event: LarkEvent): boolean {
  if (event.type !== "im.message.receive_v1") return false;
  if (event.message_type !== "text") return false;
  if (event.chat_type === "p2p") return true;
  const tid = threadKey(event);
  if (tid) {
    if (event.root_id && seedMessages.has(event.root_id)) activateThread(tid);
    if (isThreadActive(tid)) return true;
  }
  if (isMentioned(event)) return true;
  return false;
}

function formatPrompt(event: LarkEvent, taskId: string): string {
  const chatType = event.chat_type === "p2p" ? "私聊" : "群聊";
  // operator/taskId 只来自 task-store 路由结果；不得从用户文本或截断 sender_id 推断。
  return `[${chatType} | operator=${event.sender_id} | taskId=${taskId}]\n${stripMention(event.content)}`;
}

// ═══════════════ 多 pi RPC 管理 ═══════════════

/**
 * 单条飞书消息在 lark-bot 侧的完整生命周期对象。
 * - 创建时机：飞书事件入队（WS 或 poll）
 * - 状态流转：waitingTasks → activeTask → 完成（DONE/ERROR）
 * - 严格 1 对 1 绑定 activeTask，避免回复错位
 */
interface PendingTask {
  promptId: string;          // f-<seq>-<msgId后8位>
  msgId: string;             // 飞书消息 ID
  prompt: string;            // 发送给 pi 的完整内容
  reactionId: string | null; // 当前展示的反应 ID（可能是 WAVE/WAITING/THINKING）
  replyInThread: boolean;
  chatId: string | undefined;
  threadId: string | undefined;
  rootId: string | undefined;
  source: "ws" | "poll";     // 消息来源（WS 实时 / 话题轮询）
  createTime: string | undefined; // 飞书原始时间
  attemptCount: number;      // prompt 投递尝试次数（success:false 时递增重试）
  taskId: string;            // ops-base 持久化任务 ID，绝不使用 promptId 代替
  ingressMessageId: string;  // 本 turn 绑定的持久 ingress；投递前原子激活，绝不读取 latest ingress
  requiresNewSession: boolean; // 仅新建 task 在投递首条 prompt 前重置 PI session
  piSessionKey: string;       // 当前 RPC 进程键，仅用于登记真实 PI session 的宿主
}

/** 单飞取回复文本的等待句柄（completeActiveTask 期间只有一个） */
interface PendingResultFetch {
  task: PendingTask;
  expectedId: string;          // result-<promptId>
  resolve: (text: string | null) => void;
}

interface PiSession {
  proc: ChildProcess;
  ready: boolean;
  /** 当前正在处理的任务（同一会话同一时间最多 1 个） */
  activeTask: PendingTask | null;
  /** FIFO 等待队列 */
  waitingTasks: PendingTask[];
  /** 已入队/已处理消息 ID（msgId → 首次加入时间戳 Date.now()，用于 TTL + 容量淘汰） */
  seenMessageIds: Map<string, number>;
  /** 正在取 last_assistant_text + 发回复（防重入） */
  finishing: boolean;
  /** 单飞取文本的等待句柄（completeActiveTask 期间最多 1 个） */
  pendingResultFetch: PendingResultFetch | null;
  /** 正在等待 new_session → get_state → task-store 登记的首条 task */
  pendingSessionStart: PendingTask | null;
}
const sessions = new Map<string, PiSession>();
let eventSeq = 0;
let taskStore: TaskStore;
let taskRouter: LarkTaskRouter;

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
      proc: null as any,
      ready: false,
      activeTask: null,
      waitingTasks: [],
      seenMessageIds: new Map(),
      finishing: false,
      pendingResultFetch: null,
      pendingSessionStart: null,
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
    pi.proc = null as any;
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
      log(`⛔ [${task.promptId}] pi 退出，activeTask 标记 ERROR (msgId=${task.msgId.slice(-8)} source=${task.source})`);
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
    pi.pendingSessionStart = null;
    pi.ready = false;
    pi.proc = null as any;

    // 4. waitingTasks 保留（不删 sessions），让 get_state 就绪后补偿 promoteNext
    log(`💾 保留 waitingTasks=${pi.waitingTasks.length}, seenMessageIds=${pi.seenMessageIds.size}，5s 后重启`);

    setTimeout(() => startPi(sessionKey), 5000);
  });

  // 重启后重新探测 ready
  setTimeout(() => {
    if (pi.proc?.stdin) pi.proc.stdin.write('{"type":"get_state"}\n');
  }, 3000);
}

function handlePiEvent(sessionKey: string, event: Record<string, unknown>): void {
  const pi = sessions.get(sessionKey);
  if (!pi) return;

  switch (event.type) {
    case "response": {
      if (event.command === "new_session") {
        const task = pi.pendingSessionStart;
        const cancelled = (event as any).data?.cancelled === true;
        if (!task || pi.activeTask?.promptId !== task.promptId) {
          log(`⚠ 收到 new_session 响应但无待启动 task`);
        } else if (!event.success || cancelled) {
          finishTaskWithError(pi, task, cancelled ? "PI new_session 被取消" : "PI new_session 失败");
        } else {
          // 单飞：new_session 成功后才查询真实 sessionId/sessionFile，再允许投递首条 prompt。
          pi.proc.stdin?.write('{"type":"get_state"}\n');
        }
      } else if (event.command === "get_state" && event.success) {
        pi.ready = true;
        const task = pi.pendingSessionStart;
        if (task) {
          void finishTaskSessionStart(pi, task, (event as any).data).catch((error) => {
            log(`💥 PI session 登记失败: ${error?.message?.slice(0, 200)}`);
            finishTaskWithError(pi, task, "PI session 登记失败");
          });
          break;
        }
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
            log(`✅ prompt 接受 promptId=${task.promptId} msgId=${task.msgId.slice(-8)} source=${task.source} attempt=${task.attemptCount}，等待 agent_settled`);
          } else {
            log(`❌ prompt 拒绝 promptId=${task.promptId} msgId=${task.msgId.slice(-8)} source=${task.source} attempt=${task.attemptCount}`);
            if (task.attemptCount === 0) {
              // 首次失败：重试，unshift 到队首保持原始顺序
              task.attemptCount++;
              switchReaction(task, EMOJI_WAITING);
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
      log(`🔚 agent_end promptId=${task?.promptId ?? "?"} msgId=${task?.msgId?.slice(-8) ?? "?"} source=${task?.source ?? "?"} willRetry=${willRetry}（不消费、不回复、不晋升）`);
      break;
    }
    case "agent_settled": {
      // agent_settled = Agent 真正完成，发起 completeActiveTask
      const task = pi.activeTask;
      if (!task) {
        log(`⚠ agent_settled 但 activeTask 为空`);
        break;
      }
      log(`🏁 agent_settled promptId=${task.promptId} msgId=${task.msgId.slice(-8)} source=${task.source}，开始 completeActiveTask`);
      // 不 await：响应处理是同步路径，完成是异步后台运行
      completeActiveTask(pi).catch((e) => log(`💥 completeActiveTask 异常: promptId=${task.promptId} err=${e?.message?.slice(0, 200)}`));
      break;
    }
  }
}

// ═══════════════ 飞书事件处理 ═══════════════

/**
 * 启动处理一个任务：占位 activeTask、切换到 THINKING 表情、向 pi 投递 prompt。
 * 投递成功/失败由 pi RPC 的 prompt 响应决定（成功 → 等 agent_settled；失败 → attemptCount++ 重试）。
 */
function sendPrompt(pi: PiSession, task: PendingTask): void {
  const line = JSON.stringify({ type: "prompt", id: task.promptId, message: task.prompt });
  pi.proc.stdin?.write(line + "\n");
  log(`🚀 startTask taskId=${task.taskId} promptId=${task.promptId} msgId=${task.msgId.slice(-8)} source=${task.source} queue=${pi.waitingTasks.length}`);
}

async function finishTaskSessionStart(pi: PiSession, task: PendingTask, data: any): Promise<void> {
  if (pi.pendingSessionStart?.promptId !== task.promptId || pi.activeTask?.promptId !== task.promptId) return;
  const piSessionId = data?.sessionId;
  const sessionFile = data?.sessionFile;
  if (typeof piSessionId !== "string" || !piSessionId || typeof sessionFile !== "string" || !sessionFile) {
    throw new Error("get_state 未返回 sessionId/sessionFile");
  }
  const state = await taskStore.readTask(task.taskId);
  if (state.lifecycle.state === "ENDED") {
    throw new Error("task 已结束，拒绝投递首条 prompt");
  }
  await taskStore.recordPiSession(task.taskId, state.documentRevision, {
    piSessionId,
    sessionFile,
    sessionKey: task.piSessionKey,
  });
  pi.pendingSessionStart = null;
  sendPrompt(pi, task);
}

function startTask(pi: PiSession, task: PendingTask): void {
  pi.activeTask = task;
  switchReaction(task, EMOJI_THINKING);
  // 排队消息可能已被更新的 ingress 覆盖；每一 turn 投递前须显式激活其自身 envelope。
  void taskStore.activateIngress(task.taskId, task.ingressMessageId).then(() => {
    if (pi.activeTask?.promptId !== task.promptId) return;
    if (task.requiresNewSession) {
      pi.pendingSessionStart = task;
      pi.proc.stdin?.write('{"type":"new_session"}\n');
      log(`🆕 taskId=${task.taskId} ingress=${task.ingressMessageId.slice(-8)} 在首条 prompt 前请求 PI new_session`);
      return;
    }
    sendPrompt(pi, task);
  }).catch((error) => {
    log(`💥 激活 task ingress 失败: ${error?.message?.slice(0, 200)}`);
    finishTaskWithError(pi, task, "可信消息上下文激活失败");
  });
}

/**
 * 从 waitingTasks 队首取下一个任务启动。
 *   - 有任务：startTask（自动占位 activeTask + 切表情 + 投 prompt）
 *   - 队列空：activeTask 保持 null，会话进入空闲
 *   - activeTask 非空时拒绝调用（防御性，避免覆盖正在处理的任务）
 */
function promoteNext(pi: PiSession): void {
  if (pi.activeTask) {
    log(`⚠ promoteNext 但 activeTask 非空: ${pi.activeTask.promptId}（跳过）`);
    return;
  }
  const next = pi.waitingTasks.shift();
  if (!next) {
    log(`💤 队列空，session 空闲`);
    return;
  }
  void taskStore.readTask(next.taskId).then((state) => {
    if (["ENDED", "CLEANING", "ERROR", "CANCELLING", "RESTORING"].includes(state.lifecycle.state)) {
      log(`⏭ taskId=${next.taskId} lifecycle=${state.lifecycle.state}，拒绝投递排队 prompt`);
      switchReaction(next, EMOJI_ERROR);
      promoteNext(pi);
      return;
    }
    startTask(pi, next);
  }).catch((error) => {
    log(`💥 投递前读取 task state 失败: ${error?.message?.slice(0, 160)}`);
    finishTaskWithError(pi, next, "task 状态读取失败");
  });
}

/**
 * 任务异常结束（用于 prompt 二次被拒 / 其他本地不可恢复错误）：
 *   ERROR 表情 → 结构化日志（promptId/msgId/source/reason）→ 飞书错误回复
 *   → 若为 activeTask 则清空 + finishing=false + promoteNext
 *
 * 约束（已送 Agent 不得重放）：
 *   - finishTaskWithError 调用点仅限 prompt 二次被拒（attempts > 0）。
 *     Agent 内部阶段的错误统一走 completeActiveTask（agent_settled 后），
 *     该路径不重发 prompt，也不重投该任务。
 *   - 不再将 task 推回 waitingTasks，避免错误任务被重新 pop 启动。
 */
function finishTaskWithError(pi: PiSession, task: PendingTask, reason: string): void {
  log(`⛔ [${task.promptId}] ERROR: msgId=${task.msgId.slice(-8)} source=${task.source} reason=${reason}`);
  switchReaction(task, EMOJI_ERROR);
  const errText = `❌ 处理失败：${reason}\n请重试或联系管理员。`;
  try {
    sendReply(task.msgId, errText, task.replyInThread);
  } catch (e: any) {
    log(`回复 ERROR 失败: ${e?.message?.slice(0, 80)}`);
  }
  if (pi.activeTask?.promptId === task.promptId) {
    if (pi.pendingSessionStart?.promptId === task.promptId) pi.pendingSessionStart = null;
    pi.activeTask = null;
    pi.finishing = false; // 防御性：避免异常路径下 finishing 残留
    promoteNext(pi);
  } else {
    log(`⚠ finishTaskWithError 时 activeTask 不匹配: active=${pi.activeTask?.promptId ?? "null"} task=${task.promptId}`);
    // 即使不匹配，也确保 finishing 复位（极端并发场景的兜底）
    pi.finishing = false;
  }
}

/** 步骤 7：完成 activeTask 的统一收尾 */
const TEXT_FETCH_TIMEOUT_MS = 20_000;

/**
 * 完成当前 activeTask（agent_settled 后调用）：
 *   1. 取 task = activeTask；为空则 return
 *   2. pi.finishing = true（防重入）
 *   3. 发送 { type:"get_last_assistant_text", id:`result-<promptId>` }
 *   4. 等待响应：按 id 匹配；若响应未回显 id，按"单飞"规则用 pendingResultFetch
 *   5. 文本有效 → 异步发飞书回复（带超时）
 *   6. 拿到 replyId → DONE；否则 ERROR
 *   7. 无论成败：activeTask = null；finishing = false
 *   8. promoteNext(pi)
 */
async function completeActiveTask(pi: PiSession): Promise<void> {
  if (pi.finishing) {
    log(`⚠ completeActiveTask 重入跳过`);
    return;
  }
  const task = pi.activeTask;
  if (!task) {
    log(`⚠ completeActiveTask 但 activeTask 为空`);
    return;
  }
  pi.finishing = true;

  // agent_settled 只表示 PI turn 空闲；任务是否结束始终以 task-store state 为准。
  try {
    const state = await taskStore.readTask(task.taskId);
    log(`🏁 [${task.promptId}] agent_settled taskId=${task.taskId} lifecycle=${state.lifecycle.state}`);
  } catch (error: any) {
    finishTaskWithError(pi, task, `读取 task state 失败：${error?.message ?? "unknown"}`);
    return;
  }

  const fetchId = `result-${task.promptId}`;

  // 3+4：发请求并 await 响应（或超时）
  const fetched = new Promise<string | null>((resolve) => {
    pi.pendingResultFetch = { task, expectedId: fetchId, resolve };
  });
  const timeoutHit = new Promise<"__TIMEOUT__">((resolve) =>
    setTimeout(() => resolve("__TIMEOUT__"), TEXT_FETCH_TIMEOUT_MS)
  );
  pi.proc?.stdin?.write(JSON.stringify({ type: "get_last_assistant_text", id: fetchId }) + "\n");
  log(`🔍 [${task.promptId}] 请求 get_last_assistant_text msgId=${task.msgId.slice(-8)} source=${task.source} fetchId=${fetchId} timeout=${TEXT_FETCH_TIMEOUT_MS}ms`);

  const raw = await Promise.race([fetched, timeoutHit]);
  pi.pendingResultFetch = null;
  const text = (typeof raw === "string" && raw !== "__TIMEOUT__") ? raw.trim() : null;

  // 5+6：处理文本 + 发回复
  if (!text) {
    const reason = raw === "__TIMEOUT__" ? "agent 返回文本超时" : "agent 未返回文本";
    log(`⛔ [${task.promptId}] ERROR msgId=${task.msgId.slice(-8)} source=${task.source} reason=${reason}`);
    switchReaction(task, EMOJI_ERROR);
    try { sendReply(task.msgId, `❌ 处理失败：${reason}`, task.replyInThread); } catch (e: any) {
      log(`回复 ERROR 失败: ${e?.message?.slice(0, 80)}`);
    }
  } else {
    log(`📝 [${task.promptId}] 收到 agent 文本 msgId=${task.msgId.slice(-8)} source=${task.source} len=${text.length}`);
    // 发送飞书回复（sendReplyGetId 内置超时，结果不明确走 ERROR + 日志，不重发）
    const result = await sendReplyGetId(task.msgId, text, task.replyInThread);
    // DIAG-RPLY: record reply routing for cross-session coupling debugging
    log(`🔍 [DIAG-RPLY] task=${task.promptId} expected_chat_type=${task.chatId ? "group" : "p2p"} expected_chat_id=${task.chatId?.slice(-12) ?? "p2p"} msgId=${task.msgId.slice(-8)} replyId=${result.replyId?.slice(-8) ?? "null"} ok=${result.ok}`);
    if (result.ok && result.replyId) {
      log(`✅ [${task.promptId}] DONE msgId=${task.msgId.slice(-8)} source=${task.source} replyId=${result.replyId.slice(-8)} text.len=${text.length} content="${text.slice(0, 50)}"`);
      switchReaction(task, EMOJI_DONE);
      seedMessages.add(task.msgId);
      seedMessages.add(result.replyId);
    } else {
      const reason = result.timedOut ? `回复超时（${REPLY_SEND_TIMEOUT_MS}ms）` : (result.error || "未知错误");
      log(`⛔ [${task.promptId}] ERROR msgId=${task.msgId.slice(-8)} source=${task.source} timedOut=${result.timedOut ?? false} reason=${reason}`);
      switchReaction(task, EMOJI_ERROR);
    }
  }

  // 7+8：清理 + 晋升
  pi.activeTask = null;
  pi.finishing = false;
  promoteNext(pi);
}

/**
 * 飞书事件统一入口（WS 实时 + 话题轮询共用）。
 *   1. 路由 + shouldHandle 过滤
 *   2. seenMessageIds 单次运行内去重（防 WS+poll 重复）
 *   3. 创建 PendingTask，初始表情 WAVE
 *   4. 分流：activeTask 空 → 立即 startTask；否则 → 表情 WAITING + push 等待队列
 */
async function handleLarkEvent(event: LarkEvent, source: "ws" | "poll"): Promise<void> {
  // DIAG-EVT: record inbound event routing context (chat_type/chat_id/msgId/sender_type/source)
  log(`🔍 [DIAG-EVT] chat_type=${event.chat_type} chat_id=${event.chat_id?.slice(-12) ?? "null"} msgId=${event.message_id.slice(-8)} sender_type=${(event as any).sender_type ?? "?"} source=${source} thread=${event.thread_id ? "y" : "n"}`);
  if (event.chat_id) knownChatIds.add(event.chat_id);
  if (!shouldHandle(event)) return;

  const key = sessionKey(event);
  // DIAG-RT: record routing decision
  log(`🔍 [DIAG-RT] sessionKey=${key} msgId=${event.message_id.slice(-8)}`);
  const pi = sessions.get(key);
  if (!pi?.ready || !taskRouter) { sendReply(event.message_id, "Bot 启动中，请稍后再试..."); return; }

  const tid = threadKey(event);
  if (tid) { activateThread(tid); }

  // 1. 统一去重（单次运行内）
  if (pi.seenMessageIds.has(event.message_id)) {
    log(`⏭ [${key.slice(-12)}] 重复消息跳过: msgId=${event.message_id.slice(-8)} source=${source}`);
    return;
  }
  pi.seenMessageIds.set(event.message_id, Date.now());

  // 2. task-store 是唯一运营任务路由源；sender_id 必须是完整 Feishu open_id。
  let routed: any;
  try {
    routed = await taskRouter.route({
      chatId: event.chat_id,
      chatType: event.chat_type,
      feishuOpenId: event.sender_id,
      threadId: event.thread_id,
      rootMessageId: event.root_id,
      triggerMessageId: event.message_id,
      createdAt: event.create_time,
      text: stripMention(event.content),
    });
  } catch (error: any) {
    log(`⛔ task 路由失败 msgId=${event.message_id.slice(-8)}：${error?.message?.slice(0, 160)}`);
    sendReply(event.message_id, "无法验证运营身份或任务状态，操作已拒绝。", !!tid);
    return;
  }
  if (routed.kind === "rejected") {
    log(`⛔ task 路由拒绝 msgId=${event.message_id.slice(-8)} activeTask=${routed.state.taskId}`);
    sendReply(event.message_id, "当前已有运营任务处理中，请等待其结束后再创建新任务。", !!tid);
    return;
  }
  if (routed.deduplicated) {
    // WS/poll 或 Bot restart 后的同 messageId：state 已给出同一 task，但绝不重复投递 prompt。
    log(`⏭ 持久 ingress 去重 taskId=${routed.state.taskId} msgId=${event.message_id.slice(-8)}`);
    return;
  }

  const promptId = `f-${++eventSeq}-${event.message_id.slice(-8)}`;
  const task: PendingTask = {
    promptId,
    msgId: event.message_id,
    prompt: formatPrompt(event, routed.state.taskId),
    reactionId: null,
    replyInThread: !!tid,
    chatId: event.chat_id,
    threadId: event.thread_id,
    rootId: event.root_id,
    source,
    createTime: event.create_time,
    attemptCount: 0,
    taskId: routed.state.taskId,
    ingressMessageId: routed.resource.locator.messageId,
    requiresNewSession: routed.kind === "created",
    piSessionKey: key,
  };

  // 3. WAVE
  task.reactionId = addReaction(event.message_id, EMOJI_READ);
  log(`📩 [${key.slice(-12)}] taskId=${task.taskId} route=${routed.kind} msgId=${event.message_id.slice(-8)} promptId=${promptId} source=${source} queue=${pi.waitingTasks.length} active=${pi.activeTask?.promptId ?? "null"} content="${event.content.slice(0, 40)}"`);

  // 4. 同一 task 的连续消息可沿用当前 PI session FIFO；不同 task 已在路由层拒绝。
  if (pi.activeTask === null) {
    startTask(pi, task);
  } else {
    switchReaction(task, EMOJI_WAITING);
    pi.waitingTasks.push(task);
    log(`⏳ [${promptId}] WAITING taskId=${task.taskId} msgId=${task.msgId.slice(-8)} source=${task.source} depth=${pi.waitingTasks.length}`);
  }
}

// ═══════════════ lark-cli 事件流 ═══════════════

function startLarkEvents(): ChildProcess {
  log("启动 lark-cli event consume ...");
  const child = spawn(CLI, ["event", "consume", "im.message.receive_v1", "--as", "bot"], { stdio: ["pipe", "pipe", "pipe"] });

  let buf = "";
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString("utf-8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try { void handleLarkEvent(JSON.parse(line), "ws").catch((error) => log(`WS task 路由异常: ${error?.message?.slice(0, 160)}`)); } catch {}
    }
  });

  child.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString("utf-8").trim();
    if (msg.includes("[event] ready")) log("✅ 飞书 WebSocket 已就绪");
    else if (msg.includes("[event] exited")) log(`飞书事件流结束: ${msg}`);
    else if (msg.includes('"ok":false')) log(`飞书错误: ${msg.slice(0, 200)}`);
  });

  child.on("exit", (code) => { log(`飞书事件流退出 code=${code}`); setTimeout(startLarkEvents, 5000); });
  return child;
}

// ═══════════════ 主入口 ═══════════════

function cleanupOldSessions(): void {
  const sessionRoot = join(PROJECT_DIR, ".pi", "sessions");
  const now = Date.now();
  const maxAgeMs = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    const chatDirs = readdirSync(sessionRoot);
    for (const chatDir of chatDirs) {
      const dirPath = join(sessionRoot, chatDir);
      let st;
      try { st = statSync(dirPath); } catch { continue; }
      if (!st.isDirectory()) continue;
      const entries = readdirSync(dirPath)
        .filter(f => f.endsWith(".jsonl"))
        .map(f => {
          const p = join(dirPath, f);
          let mt = 0;
          try { mt = statSync(p).mtimeMs; } catch {}
          return { name: f, path: p, mtime: mt };
        })
        .sort((a, b) => b.mtime - a.mtime);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const isBeyondKeep = i >= SESSION_KEEP_PER_CHAT;
        const isTooOld = (now - e.mtime) > maxAgeMs;
        const isRecent = (now - e.mtime) < SESSION_ACTIVE_THRESHOLD_MS;
        if ((isBeyondKeep || isTooOld) && !isRecent) {
          try { unlinkSync(e.path); removed++; } catch {}
        }
      }
    }
  } catch {}
  if (removed > 0) {
    log(`🧹 [session cleanup] removed ${removed} old files (>${SESSION_MAX_AGE_DAYS}d or beyond top-${SESSION_KEEP_PER_CHAT})`);
  }
}
setTimeout(() => cleanupOldSessions(), 60 * 1000);
setInterval(cleanupOldSessions, 24 * 60 * 60 * 1000);

function startAllPi(): void {
  // 私聊 session
  startPi("p2p");

  // 群聊 session — 通过 raw API 获取
  try {
    const out = execSync(
      `"${CLI}" api GET '/open-apis/im/v1/chats?page_size=20' --as bot --format json`,
      { timeout: 10000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const items = JSON.parse(out).data?.items || [];
    for (const c of items) {
      startPi(`group:${c.chat_id}`);
    }
  } catch (e: any) {
    log(`获取群聊列表失败: ${e.message?.slice(0, 80)}`);
  }
}

async function initializeTaskRuntime(): Promise<void> {
  taskStore = new TaskStore({ workspaceRoot: PROJECT_DIR });
  await taskStore.initialize();
  taskRouter = new LarkTaskRouter(taskStore);
  const active = await taskStore.recoverActiveTask();
  if (active) log(`🔒 恢复 active task taskId=${active.taskId} lifecycle=${active.lifecycle.state}`);
  const recovery = await new TaskEndService({ taskStore, workspaceRoot: PROJECT_DIR }).recoverAll();
  for (const result of recovery) {
    if (result.kind === "recovered") log(`✅ CREATE_PR 对账恢复 taskId=${result.taskId}`);
    if (result.kind === "manual") log(`⚠ 启动恢复需人工处理 taskId=${result.taskId}：${result.reason ?? "请人工对账"}`);
  }
}

async function main(): Promise<void> {
  await initializeTaskRuntime();
  // 启动期 PID 校验：使用 isAlive() 确保 Windows 下也能准确检测
  if (existsSync(PID_FILE)) {
    try {
      const oldPid = Number(readFileSync(PID_FILE, "utf-8").trim());
      if (oldPid > 0 && isAlive(oldPid)) {
        log(`已在运行 pid=${oldPid}`);
        process.exit(0);
      }
    } catch {}
  }
  writeFileSync(PID_FILE, String(process.pid));
  log("════════ lark-bot 启动 ════════");
  startAllPi();
  startLarkEvents();

  // ═══════════════ 双 PID 看门狗 ═══════════════
  // 监控 DIRECT_PARENT（tsx CLI）和 AGENT_PID（PI Agent），任一退出即清理
  // 设计说明：依赖 OS PID 生命周期，未引入 PID identity 校验。
  //          PID reuse 在 5s 间隔 + 现代 OS 分配策略下概率极低。
  const DIRECT_PARENT = process.ppid;
  const AGENT_PID = process.env.LARK_PARENT_PID
    ? Number(process.env.LARK_PARENT_PID)
    : null;

  const monitoredPids: number[] = [DIRECT_PARENT];
  if (AGENT_PID && AGENT_PID > 0 && AGENT_PID !== DIRECT_PARENT) {
    monitoredPids.push(AGENT_PID);
  }

  log(`看门狗监控 PID=[${monitoredPids.join(", ")}]`);
  const watchdog = setInterval(() => {
    for (const pid of monitoredPids) {
      if (!isAlive(pid)) {
        log(`进程 ${pid} 已退出，lark-bot 自动终止`);
        clearInterval(watchdog);
        cleanup();
        return;
      }
    }
  }, 5000);

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", () => { try { unlinkSync(PID_FILE); } catch {} });

  // ═══════════════ IPC shutdown ═══════════════
  // extension 通过 stdin pipe 发送 {"type":"shutdown"}，触发优雅退出
  // 解决 Windows 下 subprocess.kill("SIGTERM") = TerminateProcess（硬杀）
  // 导致 cleanup() 和 process.on("exit") 都不执行、PID_FILE 残留的问题
  process.stdin.on("data", (d: Buffer) => {
    try {
      if (JSON.parse(d.toString("utf-8")).type === "shutdown") cleanup();
    } catch {}
  });
}

function cleanup(): void {
  for (const [, s] of sessions) { try { s.proc.kill(); } catch {} }
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}

main().catch((error) => {
  log(`💥 lark-bot 初始化失败：${error?.message?.slice(0, 240)}`);
  process.exit(1);
});
