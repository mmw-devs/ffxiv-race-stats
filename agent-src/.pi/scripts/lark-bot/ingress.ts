/**
 * ingress.ts — L2 Ingress 层
 *
 * SSOT 视角：
 *   - 飞书事件 → 类型化 PromptTask（已完成 dedup、thread 激活判定）
 *   - 入口事件来源：WS（实时）+ topic poll（兜底）
 *   - 不持有 session 状态；通过调用 session-manager API 完成入队
 *
 * 本模块持有：
 *   - activeThreads Map<tid, lastActiveAt>（30min TTL）
 *   - shouldHandle / formatPrompt / threadKey 决策函数
 *   - handleLarkEvent 统一入口
 *   - 60s 周期清理器（activeThreads + seedMessages + seenMessageIds）
 */

import { EMOJI_READ, EMOJI_WAITING, THREAD_TTL_MS } from "./config.js";
import type { LarkEvent, PendingTask } from "./shared/types.js";
import { log } from "./shared/logger.js";
import { addReaction, isMentioned, registerKnownChat, sendReply, setPollThreadActiveChecker, stripMention, switchReaction } from "./protocol/feishu.js";
import { seedMessages } from "./interactive/task-state-machine.js";
import {
  enqueueTask,
  startImmediate,
} from "./interactive/task-state-machine.js";
import {
  getPiSession,
  hasSeen,
  isSessionReady,
  markSeen,
  nextPromptId,
  cleanupSeenMessageIds,
} from "./interactive/session-manager.js";

// ═══════════════ 路由决策（与 routing.ts 一致；保留 here 作为调用入口） ═══════════════

function sessionKey(event: LarkEvent): string {
  if (event.chat_type === "p2p") return "p2p";
  return `group:${event.chat_id}`;
}

// ═══════════════ thread 激活状态 ═══════════════

const activeThreads = new Map<string, number>();

function activateThread(tid: string): void { activeThreads.set(tid, Date.now()); }
function isThreadActive(tid: string): boolean { return activeThreads.has(tid); }
function threadKey(e: LarkEvent): string | null { return e.thread_id || e.root_id || null; }

// 注入 protocol/feishu 的 poll 线程活跃度查询回调
setPollThreadActiveChecker(isThreadActive);

// ═══════════════ 过滤与翻译 ═══════════════

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

// ═══════════════ 飞书事件统一入口（WS 实时 + 话题轮询共用） ═══════════════

/**
 * 飞书事件统一入口（WS 实时 + 话题轮询共用）。
 *   1. 注册 chatId 到 knownChatIds（protocol/feishu）
 *   2. shouldHandle 过滤
 *   3. seenMessageIds 单次运行内去重（防 WS+poll 重复）
 *   4. 创建 PendingTask，初始表情 WAVE
 *   5. 分流：activeTask 空 → 立即 startTask；否则 → 表情 WAITING + push 等待队列
 */
export function handleLarkEvent(event: LarkEvent, source: "ws" | "poll"): void {
  // DIAG-EVT: record inbound event routing context (chat_type/chat_id/msgId/sender_type/source)
  log(`🔍 [DIAG-EVT] chat_type=${event.chat_type} chat_id=${event.chat_id?.slice(-12) ?? "null"} msgId=${event.message_id.slice(-8)} sender_type=${event.sender_type ?? "?"} source=${source} thread=${event.thread_id ? "y" : "n"}`);
  if (event.chat_id) registerKnownChat(event.chat_id);
  if (!shouldHandle(event)) return;

  const key = sessionKey(event);
  // DIAG-RT: record routing decision
  log(`🔍 [DIAG-RT] sessionKey=${key} msgId=${event.message_id.slice(-8)}`);

  if (!isSessionReady(key)) {
    sendReply(event.message_id, "Bot 启动中，请稍后再试...");
    return;
  }

  const pi = getPiSession(key);
  if (!pi) return; // 不可能走到这里（isSessionReady 已检查）

  const tid = threadKey(event);
  if (tid) { activateThread(tid); }

  // 1. 统一去重（单次运行内）
  if (hasSeen(pi, event.message_id)) {
    log(`⏭ [${key.slice(-12)}] 重复消息跳过: msgId=${event.message_id.slice(-8)} source=${source}`);
    return;
  }
  markSeen(pi, event.message_id);

  // 2. 创建 task
  const task: PendingTask = {
    promptId: nextPromptId(event.message_id),
    msgId: event.message_id,
    prompt: formatPrompt(event),
    reactionId: null,
    replyInThread: !!tid,
    chatId: event.chat_id,
    threadId: event.thread_id,
    rootId: event.root_id,
    source,
    createTime: event.create_time,
    attemptCount: 0,
  };

  // 3. WAVE
  task.reactionId = addReaction(event.message_id, EMOJI_READ);
  log(`📩 [${key.slice(-12)}] 入队 msgId=${event.message_id.slice(-8)} promptId=${task.promptId} source=${source} queue=${pi.waitingTasks.length} active=${pi.activeTask?.promptId ?? "null"} content="${event.content.slice(0, 40)}"`);

  // 4. 分流
  if (pi.activeTask === null) {
    startImmediate(pi, task);
  } else {
    switchReaction(task, EMOJI_WAITING);
    enqueueTask(pi, task);
    log(`⏳ [${task.promptId}] WAITING 分支 msgId=${task.msgId.slice(-8)} source=${task.source} depth=${pi.waitingTasks.length}`);
  }
}

// ═══════════════ 60s 周期清理 ═══════════════

/**
 * 60s 周期清理：
 *   - activeThreads TTL 超过 30min 的过期条目制除
 *   - seedMessages 容量超 100 时全清（保留少量"种子"消息即可）
 *   - 各 session 的 seenMessageIds TTL + LRU 清理（由 session-manager 暴露）
 */
setInterval(() => {
  const now = Date.now();
  // activeThreads TTL
  for (const [tid, last] of activeThreads) {
    if (now - last > THREAD_TTL_MS) activeThreads.delete(tid);
  }
  // seedMessages 容量
  if (seedMessages.size > 100) seedMessages.clear();

  // seenMessageIds 委托给 session-manager
  const { evictedTtl, evictedLru, remaining } = cleanupSeenMessageIds();
  if (evictedTtl > 0 || evictedLru > 0) {
    log(`🧹 [seenMessageIds 清理] ttl=${evictedTtl} lru=${evictedLru} 剩=${remaining}`);
  }
}, 60_000);
