/**
 * protocol/feishu.ts — L1 Protocol 层（飞书适配器）
 *
 * SSOT 视角：所有与 lark-cli 的对话经由此模块；本模块不持有任何
 * 业务状态（dedup / 路由 / 任务队列归 ingress 与 session-manager）。
 *
 * 本文件持有：
 *   - 飞书事件原始类型（LarkEvent）
 *   - 表情协议（addReaction / delReaction / switchReaction）
 *   - 消息回复（sendReply / sendReplyGetId）
 *   - WS 事件流（startLarkEvents）
 *   - 话题轮询（pollActiveThreads）+ knownChatIds / polledMsgIds 状态封装
 *
 * 不持有（即使历史上曾在本文件出现）：
 *   - 任务状态机 → task-state-machine.ts
 *   - session 状态 → session-manager.ts
 *   - dedup 表 → ingress.ts
 */

import { spawn, ChildProcess, execSync } from "node:child_process";
import {
  BOT_NAME,
  CLI,
  EMOJI_READ,
  REPLY_SEND_TIMEOUT_MS,
} from "../config.js";
import type {
  LarkEvent,
  SendReplyResult,
  TaskReactionView,
} from "../shared/types.js";
import { log } from "../shared/logger.js";

// ═══════════════ 表情协议 ═══════════════

function addReaction(msgId: string, emoji: string): string | null {
  try {
    const params = JSON.stringify({ message_id: msgId });
    const data = JSON.stringify({ reaction_type: { emoji_type: emoji } });
    const out = execSync(
      `"${CLI}" im reactions create --as bot --params '${params}' --data '${data}'`,
      { timeout: 5000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
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
export function switchReaction(task: TaskReactionView, emoji: string): string | null {
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

export function sendReply(msgId: string, text: string, replyInThread = false): void {
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
export function sendReplyGetId(msgId: string, text: string, replyInThread = false): Promise<SendReplyResult> {
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

// ═══════════════ 飞书事件原始解析 ═══════════════

/**
 * 注意：sender_type 不在原始事件 schema 中，由 DIAG-EVT 日志按需补充。
 * 这里仅声明可选字段，调用方用 event.sender_type ?? "?" 取值。
 */

/**
 * 检测本事件是否 mention 了 Bot（@Bot_NAME 或 @BOT_OPEN_ID）。
 * 由 ingress.shouldHandle 调用。
 */
export function isMentioned(event: LarkEvent): boolean {
  for (const m of event.mentions ?? []) {
    if (m.id === BOT_OPEN_ID || m.name === BOT_NAME) return true;
  }
  return false;
}

/**
 * 去除消息开头的 @提及。
 * 注意：原代码中正则存在一处 `\S` 写成了字面 `\\S`（疑似 bug），保留以保持行为零变化。
 */
export function stripMention(content: string): string {
  const cleaned = content.replace(new RegExp(`^@${BOT_NAME}\\s+`, "i"), "").replace(/^@\\S+\s+/, "").trim();
  return cleaned || content.trim();
}

// ═══════════════ WS 事件流 ═══════════════

/**
 * 启动 lark-cli event consume 并把 NDJSON 解析后的事件交给 onEvent 回调。
 * 返回的 ChildProcess 由调用方持有以做生命周期管理。
 */
export function startLarkEvents(onEvent: (event: LarkEvent) => void): ChildProcess {
  log("启动 lark-cli event consume ...");
  const child = spawn(CLI, ["event", "consume", "im.message.receive_v1", "--as", "bot"], { stdio: ["pipe", "pipe", "pipe"] });

  let buf = "";
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString("utf-8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line)); } catch {}
    }
  });

  child.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString("utf-8").trim();
    if (msg.includes("[event] ready")) log("✅ 飞书 WebSocket 已就绪");
    else if (msg.includes("[event] exited")) log(`飞书事件流结束: ${msg}`);
    else if (msg.includes('"ok":false')) log(`飞书错误: ${msg.slice(0, 200)}`);
  });

  child.on("exit", (code) => { log(`飞书事件流退出 code=${code}`); setTimeout(() => startLarkEvents(onEvent), 5000); });
  return child;
}

// ═══════════════ 话题轮询 + 已知 chat 状态封装 ═══════════════

const polledMsgIds = new Set<string>();
const knownChatIds = new Set<string>();

/** 注册新发现的 chat id（ingress 在收到 WS 事件时调用） */
export function registerKnownChat(chatId: string | undefined): void {
  if (chatId) knownChatIds.add(chatId);
}

/**
 * 5s 周期任务：轮询已知 chat 的最近 5 条消息，把活跃 thread 的回复交给 onPollEvent。
 * 设计：polledMsgIds 全局去重避免与 WS 重复；knownChatIds 为空则 no-op。
 */
export async function pollActiveThreads(onPollEvent: (event: LarkEvent) => void): Promise<void> {
  if (knownChatIds.size === 0) return;
  for (const chatId of knownChatIds) {
    try {
      const out = execSync(
        `"${CLI}" im +chat-messages-list --as bot --chat-id "${chatId}" --order desc --page-size 5 --format json`,
        { timeout: 8000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
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
        // 这里的 activateThread 调用由 ingress 注入（避免循环依赖）
        if (!mentioned && !isPollThreadActive(tid)) continue;
        onPollEvent({
          type: "im.message.receive_v1",
          chat_id: chatId,
          chat_type: "group",
          sender_id: msg.sender?.id || "unknown",
          message_id: msg.message_id,
          message_type: "text",
          content,
          create_time: msg.create_time || "",
          thread_id: tid,
          root_id: msg.root_id,
        });
      }
    } catch {}
  }
}

/**
 * 由 ingress 注入的「判断 thread 是否活跃」回调。
 * pollActiveThreads 不直接 import ingress（避免循环），通过 setter 注入。
 */
let isPollThreadActive: (tid: string) => boolean = () => false;
export function setPollThreadActiveChecker(checker: (tid: string) => boolean): void {
  isPollThreadActive = checker;
}
