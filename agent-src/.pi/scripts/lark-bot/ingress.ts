/**
 * ingress.ts — L2 Ingress 层
 *
 * SSOT 视角：
 *   - 飞书事件 → 类型化 PendingTask（已完成 chat_type 过滤 + dedup + 身份解析）
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
 *   - Operator 身份解析（fail-closed，未授权不入队）
 *   - PendingTask 装配
 *   - 入队分流（activeTask 空 → 立即 start；否则 push waitingTasks）
 *
 * PR #3 演进：
 *   - 在 `ensureSession` 后、`markSeen` 前调用 `resolveOperator`
 *   - 解析失败 → ERROR 表情 + "无法验证运营身份" 拒绝消息 + 不入队
 *   - 解析成功 → OperatorContext 注入 PendingTask.operator / operatorName
 *   - formatPrompt 头部改为 `[私聊 | operator=<user_id> | name=<展示名>]`
 */

import { CLI, EMOJI_ERROR, EMOJI_READ, MAX_QUEUE_DEPTH, PROJECT_DIR, REQUIRED_EVENT_FIELDS } from "./config.js";
import type { LarkEvent, PendingTask } from "./shared/types.js";
import { log } from "./shared/logger.js";
import { addReaction, sendReply, stripMention } from "./protocol/feishu.js";
import { enqueueTask, startImmediate } from "./interactive/task-state-machine.js";
import {
  cleanupSeenMessageIds,
  ensureSession,
  hasSeen,
  markSeen,
  nextPromptId,
} from "./interactive/session-manager.js";
import { sessionKey } from "./routing.js";
import { createIdentityResolver, type IdentityResolver, type OperatorContext } from "./identity-resolver.js";

// ═══════════════ 身份解析器（单例） ═══════════════

/**
 * 全局 identity resolver 单例。
 * 进程启动期构造一次，运行时缓存命中避免 lark-cli 重复调用。
 */
const identityResolver: IdentityResolver = createIdentityResolver({
  projectDir: PROJECT_DIR,
  cliPath: CLI,
  log,
});

// ═══════════════ 输入校验（R3 L2 Ingress） ═══════════════

/**
 * 校验 LarkEvent 必要字段全部存在且类型为 string。
 *
 * 防御目的：lark-cli NDJSON 可能在边缘情况下解析出残缺对象（如网络截断、
 * schema 升级期），不做校验会让下游 protocol/feishu.ts 抛 TypeError
 * 拖垮整个事件处理路径。
 *
 * 返回值：true 表示事件可信，false 表示应丢弃。
 */
export function validateLarkEvent(event: unknown): event is LarkEvent {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  for (const field of REQUIRED_EVENT_FIELDS) {
    if (typeof e[field] !== "string") return false;
  }
  // chat_type 当前架构下只能是 "p2p"；其他值（"group"）走 shouldHandle 过滤
  if (e.chat_type !== "p2p") return false;
  return true;
}

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

/**
 * 构造发给 pi 的 prompt 头部。
 * PR #3 起头部包含 operator=<user_id> + name=<展示名>，便于 pi 在 commit message
 * 中原样使用（不得由 Agent 推断 operator）。
 */
function formatPrompt(event: LarkEvent, operator: OperatorContext): string {
  return `[私聊 | operator=${operator.operator} | claim=${operator.claim} | name=${operator.name ?? "-"}]\n${stripMention(event.content)}`;
}

/** 暴露 identity resolver（测试用） */
export function getIdentityResolver(): IdentityResolver {
  return identityResolver;
}

// ═══════════════ 飞书事件统一入口（仅 WS，不再有轮询） ═══════════════

/**
 * 飞书事件入口（仅 WS）。轮询兜底已剔除。
 *   1. shouldHandle 类型守卫（chat_type=p2p && message_type=text）
 *   2. 身份解析（fail-closed，未授权不入队）
 *   3. seenMessageIds 单次运行内去重（防 WS 重连重复）
 *   4. 创建 PendingTask，初始表情 WAVE
 *   5. 分流：activeTask 空 → 立即 startTask；否则 → push 等待队列
 */
export async function handleLarkEvent(event: LarkEvent): Promise<void> {
  // R3 L2 Ingress：per-event try/catch + 输入校验 + 反压
  // 设计目的：单条坏事件不能拖垮整个 lark-bot 进程；恶意或异常高频消息不能占用队列
  try {
    // 1. 输入校验（防御 NDJSON 残缺）
    if (!validateLarkEvent(event)) {
      log(`⚠️ [ingress] 事件字段校验失败，已丢弃: type=${(event as any)?.type} chat_type=${(event as any)?.chat_type}`);
      return;
    }
    if (!shouldHandle(event)) return;

    const key = sessionKey(event);

    // commit 4：ensureSession 懒启动 pi 子进程
    //   - session 已存在 → 直接返回（同步快路径）
    //   - session 不存在 → spawn mutex 串行化，spawn 后返回新 PiSession
    // 注意：pi.ready 可能仍是 false（刚 spawn 完），任务直接入队，get_state 响应后自动 promoteNext
    const pi = await ensureSession(key, event.chat_id);

    // 2. Operator 身份解析（fail-closed）
    //    未授权或解析失败 → ERROR 表情 + 拒绝消息 + 不入队
    //    解析成功后注入到 PendingTask.operator / operatorName 字段
    const operatorCtx = await identityResolver.resolveOperator(event.sender_id);
    if (!operatorCtx) {
      log(`⚠️ [${key.slice(-12)}] 身份解析失败: senderId=${event.sender_id.slice(-12)}`);
      addReaction(event.message_id, EMOJI_ERROR);
      sendReply(event.message_id, "无法验证运营身份，操作已拒绝。请联系管理员登记飞书 user_id。");
      return;
    }

    // 3. 统一去重（单次运行内）
    if (hasSeen(pi, event.message_id)) {
      log(`⏭ [${key.slice(-12)}] 重复消息跳过: msgId=${event.message_id.slice(-8)}`);
      return;
    }
    markSeen(pi, event.message_id);

    // 4. 反压：队列满则拒绝，避免内存累积拖垮 lark-bot
    //    注意：仅对"入队等待"分支生效；activeTask 仍可立即启动（新事件时旧的已处理完）
    if (pi.waitingTasks.length >= MAX_QUEUE_DEPTH) {
      log(`⚠️ [${key.slice(-12)}] 队列已满 (depth=${pi.waitingTasks.length}), 拒绝 msgId=${event.message_id.slice(-8)}`);
      addReaction(event.message_id, EMOJI_ERROR);
      sendReply(event.message_id, "⚠️ Bot 队列已满，请稍后再试");
      return;
    }

    // 5. 创建 task（operator 注入到字段）
    const task: PendingTask = {
      promptId: nextPromptId(event.message_id),
      msgId: event.message_id,
      prompt: formatPrompt(event, operatorCtx),
      reactionId: null,
      chatId: event.chat_id,
      createTime: event.create_time,
      attemptCount: 0,
      operator: operatorCtx.operator,
      operatorName: operatorCtx.name,
    };

    // 6. WAVE
    task.reactionId = addReaction(event.message_id, EMOJI_READ);
    log(`📩 [${key.slice(-12)}] 入队 msgId=${event.message_id.slice(-8)} promptId=${task.promptId} operator=${operatorCtx.operator} (${operatorCtx.name ?? "-"}) queue=${pi.waitingTasks.length} active=${pi.activeTask?.promptId ?? "null"} ready=${pi.ready}`);

    // 7. 分流
    if (pi.activeTask === null && pi.ready) {
      startImmediate(pi, task);
    } else if (!pi.ready) {
      // 刚 spawn 完，pi 还没报告 ready：入队等 get_state 触发 promoteNext
      enqueueTask(pi, task);
      log(`⏳ [${task.promptId}] WAITING (spawn not ready) depth=${pi.waitingTasks.length}`);
    } else {
      enqueueTask(pi, task);
      log(`⏳ [${task.promptId}] WAITING 分支 depth=${pi.waitingTasks.length}`);
    }
  } catch (e: any) {
    // R3 L2 Ingress 凭底：任何未捕获异常只记日志，不传播
    // 防止单条坏事件导致 process.on('uncaughtException') 被触发
    log(`💥 [ingress] handleLarkEvent 异常: msgId=${(event as any)?.message_id?.slice?.(-8)} err=${e?.message?.slice(0, 200)}`);
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