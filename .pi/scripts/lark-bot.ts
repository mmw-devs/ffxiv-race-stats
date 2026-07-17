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
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, "..", "..");
const CLI = join(PROJECT_DIR, ".pi/npm/node_modules/@larksuite/cli/bin/lark-cli");
const PID_FILE = join(tmpdir(), "lark-bot.pid");
const LOG_FILE = join(tmpdir(), "lark-bot.log");
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
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

// ═══════════════ 表情 ═══════════════
const EMOJI_READ = "WAVE";
const EMOJI_THINKING = "THINKING";
const EMOJI_DONE = "DONE";

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

// ═══════════════ 飞书回复 ═══════════════
function sendReply(msgId: string, text: string, replyInThread = false): void {
  const args = ["im", "+messages-reply", "--as", "bot", "--message-id", msgId, "--text", text];
  if (replyInThread) args.push("--reply-in-thread");
  spawn(CLI, args, { stdio: "ignore" }).on("error", (e) => log(`reply: ${e.message}`));
}

function sendReplyGetId(msgId: string, text: string, replyInThread = false): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ["im", "+messages-reply", "--as", "bot", "--message-id", msgId, "--text", text, "--format", "json"];
    if (replyInThread) args.push("--reply-in-thread");
    let out = "";
    const p = spawn(CLI, args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout?.on("data", (d: Buffer) => { out += d.toString("utf-8"); });
    p.on("close", () => {
      try { resolve(JSON.parse(out).data?.message_id ?? null); } catch { resolve(null); }
    });
    p.on("error", () => resolve(null));
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

function activateThread(tid: string) { activeThreads.set(tid, Date.now()); }
function isThreadActive(tid: string) { return activeThreads.has(tid); }
function threadKey(e: LarkEvent): string | null { return e.thread_id || e.root_id || null; }

setInterval(() => {
  const now = Date.now();
  for (const [tid, last] of activeThreads) { if (now - last > THREAD_TTL_MS) activeThreads.delete(tid); }
  if (seedMessages.size > 100) seedMessages.clear();
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
        handleLarkEvent({
          type: "im.message.receive_v1", chat_id: chatId, chat_type: "group",
          sender_id: msg.sender?.id || "unknown", message_id: msg.message_id,
          message_type: "text", content, create_time: msg.create_time || "",
          thread_id: tid, root_id: msg.root_id,
        });
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

function formatPrompt(event: LarkEvent): string {
  const sender = event.sender_id.slice(-8);
  const chatType = event.chat_type === "p2p" ? "私聊" : "群聊";
  return `[${chatType} | 用户 ${sender}]\n${stripMention(event.content)}`;
}

// ═══════════════ 多 pi RPC 管理 ═══════════════

interface PiSession {
  proc: ChildProcess;
  ready: boolean;
  pending: Map<string, { msgId: string; reactionId: string | null; replyInThread: boolean }>;
}
const sessions = new Map<string, PiSession>();
let eventSeq = 0;

function startPi(sessionKey: string): void {
  if (sessions.has(sessionKey)) return;
  const existing = sessions.get(sessionKey);
  if (existing) { existing.proc.kill(); sessions.delete(sessionKey); }

  const sessionDir = join(PROJECT_DIR, ".pi", "sessions", `bot-${sessionKey.replace(/:/g, "-")}`);
  mkdirSync(sessionDir, { recursive: true });
  log(`[pi:${sessionKey.slice(-12)}] 启动...`);

  const pi: PiSession = { proc: null as any, ready: false, pending: new Map() };
  sessions.set(sessionKey, pi);

  pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir, "--name", `bot-${sessionKey.slice(-12)}`], {
    cwd: PROJECT_DIR, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, LARK_BOT_RUNTIME: "1" },
    shell: IS_WIN,
  });

  pi.proc.on("error", (err) => {
    log(`[pi:${sessionKey.slice(-12)}] spawn 失败: ${err.message}`);
    pi.ready = false;
    sessions.delete(sessionKey);
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
    pi.ready = false; pi.proc = null as any; sessions.delete(sessionKey);
    setTimeout(() => startPi(sessionKey), 5000);
  });

  setTimeout(() => {
    if (pi.proc?.stdin) pi.proc.stdin.write('{"type":"get_state"}\n');
  }, 3000);
}

function getPiSession(key: string): PiSession | undefined { return sessions.get(key); }

function handlePiEvent(sessionKey: string, event: Record<string, unknown>): void {
  const pi = sessions.get(sessionKey);
  if (!pi) return;

  switch (event.type) {
    case "response": {
      if (event.command === "get_state" && event.success) {
        pi.ready = true;
        log(`[pi:${sessionKey.slice(-12)}] 就绪`);
      }
      if (event.command === "get_last_assistant_text") {
        handleReply(sessionKey, event as any);
      }
      break;
    }
    case "agent_settled":
    case "agent_end": {
      const entries = [...pi.pending.entries()];
      if (entries.length > 0) {
        const [pid, pending] = entries[0];
        pi.pending.delete(pid);
        pi.pending.set("__current__", pending);
        pi.proc?.stdin?.write('{"type":"get_last_assistant_text"}\n');
      }
      break;
    }
  }
}

async function handleReply(sessionKey: string, event: { data?: { text: string | null } }): Promise<void> {
  const pi = sessions.get(sessionKey);
  if (!pi) return;
  const pending = pi.pending.get("__current__");
  pi.pending.delete("__current__");
  if (!pending) return;

  const text = event.data?.text?.trim();
  delReaction(pending.msgId, pending.reactionId ?? "");
  addReaction(pending.msgId, EMOJI_DONE);

  const replyText = text || "处理完成，但未生成文本回复。";
  const replyId = await sendReplyGetId(pending.msgId, replyText, pending.replyInThread);
  if (replyId) { seedMessages.add(pending.msgId); seedMessages.add(replyId); }
  log(`📤 [${sessionKey.slice(-12)}] ${replyText.slice(0, 50)}`);
}

// ═══════════════ 飞书事件处理 ═══════════════

function handleLarkEvent(event: LarkEvent): void {
  if (event.chat_id) knownChatIds.add(event.chat_id);
  if (!shouldHandle(event)) return;

  const key = sessionKey(event);
  const pi = getPiSession(key);
  if (!pi?.ready) { sendReply(event.message_id, "Bot 启动中，请稍后再试..."); return; }

  const tid = threadKey(event);
  if (tid) { activateThread(tid); }

  log(`📩 [${key.slice(-12)}] ${event.content.slice(0, 40)}`);

  const readReaction = addReaction(event.message_id, EMOJI_READ);
  const promptId = `f-${++eventSeq}-${event.message_id.slice(-8)}`;

  pi.pending.set(promptId, { msgId: event.message_id, reactionId: readReaction, replyInThread: !!tid });
  delReaction(event.message_id, readReaction ?? "");
  const think = addReaction(event.message_id, EMOJI_THINKING);
  pi.pending.set(promptId, { msgId: event.message_id, reactionId: think, replyInThread: !!tid });

  pi.proc.stdin?.write(JSON.stringify({ type: "prompt", id: promptId, message: formatPrompt(event) }) + "\n");
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
      try { handleLarkEvent(JSON.parse(line)); } catch {}
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

function main(): void {
  if (existsSync(PID_FILE)) {
    try { process.kill(parseInt(readFileSync(PID_FILE, "utf-8").trim()), 0); log("已在运行"); process.exit(0); } catch {}
  }
  writeFileSync(PID_FILE, String(process.pid));
  log("════════ lark-bot 启动 ════════");
  startAllPi();
  startLarkEvents();

  // ═══════════════ PPID 看门狗 ═══════════════
  // 父进程（PI Agent）异常终止时自动清理，避免孤儿进程
  // 通过 LARK_PARENT_PID 显式指定监控目标，避免 process.ppid 指向中间层（如 tsx loader）
  const MONITOR_PID = Number(process.env.LARK_PARENT_PID || process.ppid);
  const watchdog = setInterval(() => {
    try {
      process.kill(MONITOR_PID, 0);  // signal 0：仅检测进程存在性
    } catch {
      log(`父进程 ${MONITOR_PID} 已退出，lark-bot 自动终止`);
      clearInterval(watchdog);
      cleanup();
    }
  }, 5000);

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function cleanup(): void {
  for (const [, s] of sessions) { try { s.proc.kill(); } catch {} }
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}

main();
