/**
 * ingress.ts — L2 Ingress 层
 *
 * SSOT 视角：
 *   - 飞书事件 → 类型化 PendingTask（已完成 chat_type 过滤 + dedup）
 *   - 当前架构下只接收 p2p 事件（群聊事件直接丢弃）
 *   - 不持有 session 状态；通过调用 session-manager / task-state-machine API 完成入队
 *
 * 「群聊=广播」重构后移除的功能：
 *   - activeThreads Map + 30min TTL 清理（thread 激活不再需要）
 *   - seedMessages 共享状态 + 100 容量清理
 *   - shouldHandle 内群聊分支（mention / thread / root_id 判定）
 *   - formatPrompt 内 chatType 分支（恒为「私聊」）
 *   - 60s 综合清理器拆分为仅 seenMessageIds 清理（thread/seed 已无）
 *
 * 本模块保留：
 *   - dedup（seenMessageIds，防止 WS 重连重复投递）
 *   - 类型守卫（仅 chat_type=p2p + message_type=text）
 *   - PendingTask 装配
 *   - 入队分流（activeTask 空 → 立即 start；否则 push waitingTasks）
 */

import { EMOJI_READ } from "./config.js";
import type { LarkEvent, PendingTask } from "./shared/types.js";
import { log } from "./shared/logger.js";
import { addReaction, sendReply, stripMention } from "./protocol/feishu.js";
import { enqueueTask, startImmediate } from "./interactive/task-state-machine.js";
import {
  cleanupSeenMessageIds,
  getPiSession,
  hasSeen,
  isSessionReady,
  markSeen,
  nextPromptId,
} from "./interactive/session-manager.js";
import { sessionKey } from "./routing.js";

// ═══════════════ 类型守卫 ═══════════════

/**
 * 群聊事件直接丢弃。
 * 当前架构下 lark-cli WS 仍订阅 im.message.receive_v1（会同时收到群聊消息），
 * 在 ingress 处过滤，避免无效占用 dedup 表与排队资源。
 */
function shouldHandle(event: LarkEvent): boolean {
  if (event.type !== "im.message.receive_v1") return false;
  if (event.message_type !== "text") return false;
  if (event.chat_type !== "p2p") return false;
  return true;
}

function formatPrompt(event: LarkEvent): string {
  const sender = event.sender_id.slice(-8);
  return `[私聊 | 用户 ${sender}]\n${stripMention(event.content)}`;
}

// ═══════════════ 飞书事件统一入口（仅 WS，不再有轮询） ═══════════════

/**
 * 飞书事件入口（仅 WS）。轮询兜底已剔除。
 *   1. shouldHandle 类型守卫（chat_type=p2p && message_type=text）
 *   2. seenMessageIds 单次运行内去重（防 WS 重连重复）
 *   3. 创建 PendingTask，初始表情 WAVE
 *   4. 分流：activeTask 空 → 立即 startTask；否则 → push 等待队列
 */
export function handleLarkEvent(event: LarkEvent): void {
  if (!shouldHandle(event)) return;

  const key = sessionKey(event);
  if (!isSessionReady(key)) {
    sendReply(event.message_id, "Bot 启动中，请稍后再试...");
    return;
  }

  const pi = getPiSession(key);
  if (!pi) return; // 不可能走到这里（isSessionReady 已检查）

  // 1. 统一去重（单次运行内）
  if (hasSeen(pi, event.message_id)) {
    log(`⏭ [${key.slice(-12)}] 重复消息跳过: msgId=${event.message_id.slice(-8)}`);
    return;
  }
  markSeen(pi, event.message_id);

  // 2. 创建 task
  const task: PendingTask = {
    promptId: nextPromptId(event.message_id),
    msgId: event.message_id,
    prompt: formatPrompt(event),
    reactionId: null,
    chatId: event.chat_id,
    createTime: event.create_time,
    attemptCount: 0,
  };

  // 3. WAVE
  task.reactionId = addReaction(event.message_id, EMOJI_READ);
  log(`📩 [${key.slice(-12)}] 入队 msgId=${event.message_id.slice(-8)} promptId=${task.promptId} queue=${pi.waitingTasks.length} active=${pi.activeTask?.promptId ?? "null"} content="${event.content.slice(0, 40)}"`);

  // 4. 分流
  if (pi.activeTask === null) {
    startImmediate(pi, task);
  } else {
    enqueueTask(pi, task);
    log(`⏳ [${task.promptId}] WAITING 分支 msgId=${task.msgId.slice(-8)} depth=${pi.waitingTasks.length}`);
  }
}

// ═══════════════ 60s 周期清理（仅 seenMessageIds） ═══════════════

/**
 * 60s 周期清理：
 *   - 各 session 的 seenMessageIds TTL + LRU 清理
 *
 * 已剔除：
 *   - activeThreads TTL 清理（thread 激活机制已不存在）
 *   - seedMessages 容量清理（已不存在）
 */
setInterval(() => {
  const { evictedTtl, evictedLru, remaining } = cleanupSeenMessageIds();
  if (evictedTtl > 0 || evictedLru > 0) {
    log(`🧹 [seenMessageIds 清理] ttl=${evictedTtl} lru=${evictedLru} 剩=${remaining}`);
  }
}, 60_000);
