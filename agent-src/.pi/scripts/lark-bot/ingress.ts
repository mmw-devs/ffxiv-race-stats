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
 *
 * 「方向 B：业务流状态机」演进：
 *   - formatPrompt 增加 promptId 参数 + [协议] 指令行（触发 lark-bot-protocol skill 加载）
 *   - emitTaskJournal 调用从 outcome 字段迁移到 state 字段
 *   - auth_failed / queue_full / task_created 三处全部用 state 语义
 *
 * 私聊侧 MVP 演进：
 *   - 删除 identityResolver.resolveOperator 调用点（替换为群组鉴权调用链）
 *   - 增加 /quit / /switch 检测（lark-bot 域命令）
 *   - 新增 groupTool / authModule 单例
 *   - formatPrompt 头部增加 authorized 标识（替代 kind 二元化）
 *   - 调用 closeSession 走统一关闭清理
 *
 * 重构（v2）：
 *   - 删 kind 二元化（p2p-temp / p2p-business）→ 单 PiSession.authorized: boolean
 *   - 删鉴权窗口 / 鉴权轮次 / 业务配额分类 / 鉴权窗口清理
 *   - 引入 /switch 命令：closeSession 后下次消息重新鉴权
 *   - 鉴权只在 pi.authorized === false 时触发，后续消息直接业务处理
 */

import { CLI, EMOJI_DONE, EMOJI_ERROR, EMOJI_READ, MAX_QUEUE_DEPTH, PROJECT_DIR, REQUIRED_EVENT_FIELDS } from "./config.js";
import type { LarkEvent, PendingTask, PiSession } from "./shared/types.js";
import { emitTaskJournal, log } from "./shared/logger.js";
import { addReaction, sendReply, stripMention } from "./protocol/feishu.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { enqueueTask, startImmediate } from "./interactive/task-state-machine.js";
import {
  cleanupSeenMessageIds,
  closeSession,
  closeSessionFromUserIntent,
  ensureSession,
  hasSeen,
  markSeen,
  markActive,
  nextPromptId,
  tryReserveAuthorizedSlot,
} from "./interactive/session-manager.js";
import { sessionKey } from "./routing.js";
import type { AuthModule } from "./business/auth.js";
import { createAuthModule } from "./business/auth.js";
import type { BroadcastModule } from "./business/broadcast.js";
import { createBroadcastModule } from "./business/broadcast.js";
import type { GroupTool } from "./broadcast/group-tool.js";
import { createGroupTool } from "./broadcast/group-tool.js";

// ═══════════════ 群组鉴权模块（单例） ═══════════════

/**
 * 全局 groupTool 单例。被 authModule 间接使用。
 * 进程启动期构造一次，运行时缓存命中避免 lark-cli 重复调用。
 */
const groupTool: GroupTool = createGroupTool({
  cliPath: CLI,
  log,
});

/**
 * 全局 authModule 单例。
 * 进程启动期构造一次，依赖 groupTool 完成数据获取。
 * main.ts 需在启动多 EventKey 订阅前调用 authModule.initBoot() 完成冷启动。
 */
export const authModule: AuthModule = createAuthModule({
  groupTool,
  log,
});

/**
 * 全局 broadcastModule 单例。
 * 进程启动期构造一次，依赖 groupTool 完成消息发送。
 * 触发场景：matched / not_member 时广播到对应群组（工作留痕）。
 * 导出供 main.ts 注册到 session-manager 的 close_session 广播 handler。
 */
export const broadcastModule: BroadcastModule = createBroadcastModule({
  groupTool,
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
 *
 * 「方向 B」起额外包含：
 *   - promptId：agent 通过 task_log 事件上报主题时必须携带，lark-bot 据此定位 task
 *   - [协议] 指令行：明示 agent 加载 lark-bot-protocol skill（description 之外的备份）
 */
function formatPrompt(event: LarkEvent, pi: PiSession, promptId: string): string {
  // 调试（PR#162 后未生效）：SKILL.md 全 inline 到 prompt，绕过 PI Agent 自动 skill 加载机制
  // 如果这样 PI Agent 仍未 emit close_session → 确认 PI Agent 上游不支持
  let skillContent = "(skill content unavailable)";
  try {
    const skillPath = join(PROJECT_DIR, ".pi/skills/lark-bot-protocol/SKILL.md");
    if (existsSync(skillPath)) {
      skillContent = readFileSync(skillPath, "utf-8");
    }
  } catch {}
  return [
    `[私聊 | promptId=${promptId} | authorized=${pi.authorized} | openId=${event.sender_id}]`,
    `[协议] 以下为 lark-bot-protocol skill 全文。处理本任务时必须严格遵守：`,
    "```",
    skillContent,
    "```",
    `${stripMention(event.content)}`,
  ].join("\n");
}



/** 检测用户自然语言"结束"意图（中文/英文混合） */
export function matchesCloseIntent(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  const patterns = [
    /^结束[。.!！~]*$/,
    /^结束任务[。.!！~]*$/,
    /^结束(会话|对话)[。.!！~]*$/,
    /^完毕[。.!！~]*$/,
    /^完成[。.!！~]*$/,
    /^好的?[\s，,]*,?[\s，,]*?(任务|会话|对话)?[\s，,]*?(结束|完成|完毕)了?[\s，,。.!！~]*$/,
    /^done[。.!！~]*$/i,
    /^exit[。.!！~]*$/i,
    /^quit[。.!！~]*$/i,
    /^bye[。.!！~]*$/i,
    /^再见/,
  ];
  return patterns.some((re) => re.test(text));
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
    if (!shouldHandle(event)) {
      // 群聊 / 非文本消息不入队，不需要记 journal
      return;
    }

    const key = sessionKey(event);

    // commit 4：ensureSession 懒启动 pi 子进程
    const pi = await ensureSession(key, event.chat_id);
    markActive(pi);

    // 2. lark-bot 域命令（不依赖 agent）
    const content = event.content.trim();
    if (content === "/quit") {
      log(`🚪 [${key.slice(-12)}] /quit 收到，关闭会话`);
      addReaction(event.message_id, EMOJI_DONE);
      sendReply(event.message_id, "已关闭本次会话。");
      closeSession(key, "/quit");
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: "n/a",
        operator: "unknown",
        operatorName: null,
        state: "terminated",
        reason: "user_quit",
      });
      return;
    }
    if (content === "/switch") {
      log(`🔄 [${key.slice(-12)}] /switch 收到，关闭会话（下次重新鉴权）`);
      addReaction(event.message_id, EMOJI_DONE);
      sendReply(event.message_id, "已关闭当前会话，请发送新的业务描述重新鉴权。");
      closeSession(key, "/switch");
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: "n/a",
        operator: "unknown",
        operatorName: null,
        state: "terminated",
        reason: "user_switch",
      });
      return;
    }

    // 3. 群组鉴权判定（仅在未鉴权时触发）
    if (!pi.authorized) {
      const authResult = await authModule.authorize({
        openId: event.sender_id,
        businessDescription: content,
      });

      if (authResult.status === "matched") {
        // 鉴权成功 → 占用槽位 + 标记已鉴权
        if (!tryReserveAuthorizedSlot()) {
          log(`⛔ [${key.slice(-12)}] 鉴权通过但已鉴权会话配额已满`);
          addReaction(event.message_id, EMOJI_ERROR);
          sendReply(event.message_id, "⛔ 已鉴权会话配额已满，无法创建会话。请稍后再试。");
          closeSession(key, "authorized_quota_full");
          emitTaskJournal({
            eventTime: new Date().toISOString(),
            promptId: "n/a",
            operator: "unknown",
            operatorName: null,
            state: "terminated",
            reason: "authorized_quota_full",
          });
          return;
        }
        pi.authorized = true;
        pi.authedGroupId = authResult.groupId;
        pi.authedGroupName = authResult.groupName;
        pi.openId = event.sender_id;
        log(`✅ [${key.slice(-12)}] 鉴权通过: group=${authResult.groupId} "${authResult.groupName}"`);
        // 工作留痕：广播到对应群组（拿到 message_id 后记录，用于 close 时引用回复）
        const broadcastResult = await broadcastModule.announce({
          openId: event.sender_id,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          outcome: "matched",
        });
        if (broadcastResult.ok && broadcastResult.messageId) {
          pi.matchedBroadcastMessageId = broadcastResult.messageId;
          log(`📌 [${key.slice(-12)}] 记录 matched broadcast message_id=${broadcastResult.messageId.slice(-12)}`);
        }
      } else if (authResult.status === "no_match") {
        log(`⚠ [${key.slice(-12)}] 鉴权失败: no_match desc="${content.slice(0, 30)}"`);
        addReaction(event.message_id, EMOJI_ERROR);
        sendReply(event.message_id, "⚠ 未找到匹配的业务群组。请确认业务描述。");
        closeSession(key, "no_match");
        emitTaskJournal({
          eventTime: new Date().toISOString(),
          promptId: "n/a",
          operator: "unknown",
          operatorName: null,
          state: "terminated",
          reason: "no_match",
        });
        return;
      } else if (authResult.status === "not_member") {
        log(`⚠ [${key.slice(-12)}] 鉴权失败: not_member group=${authResult.groupId}`);
        addReaction(event.message_id, EMOJI_ERROR);
        sendReply(event.message_id, `⚠ 你不在授权群组 "${authResult.groupName}" 中，无法创建业务会话。`);
        // 工作留痕：广播到对应群组
        await broadcastModule.announce({
          openId: event.sender_id,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          outcome: "not_member",
        });
        closeSession(key, "not_member");
        emitTaskJournal({
          eventTime: new Date().toISOString(),
          promptId: "n/a",
          operator: "unknown",
          operatorName: null,
          state: "terminated",
          reason: "not_member",
        });
        return;
      } else {
        // auth_module_error
        log(`⛔ [${key.slice(-12)}] 鉴权模块错误: ${authResult.reason}`);
        addReaction(event.message_id, EMOJI_ERROR);
        sendReply(event.message_id, "⛔ 鉴权模块异常，请稍后再试。");
        closeSession(key, "auth_module_error");
        emitTaskJournal({
          eventTime: new Date().toISOString(),
          promptId: "n/a",
          operator: "unknown",
          operatorName: null,
          state: "terminated",
          reason: "auth_module_error",
        });
        return;
      }
    }

    // 8. 业务私聊阶段：去重 + 反压 + 创建 task
    if (hasSeen(pi, event.message_id)) {
      log(`⏭ [${key.slice(-12)}] 重复消息跳过: msgId=${event.message_id.slice(-8)}`);
      return;
    }
    markSeen(pi, event.message_id);

    // 8a. 自然语言关闭检测（仅 authorized=true 时生效）——lark-bot 自己处理，不依赖 PI Agent 协议
    {
      const stripped = stripMention(event.content);
      const closeMatched = matchesCloseIntent(stripped);
      log(`🔍 [${key.slice(-12)}] close-intent check: raw="${event.content.slice(0, 50)}" stripped="${stripped.slice(0, 50)}" matched=${closeMatched} authorized=${pi.authorized}`);
    }
    if (pi.authorized && matchesCloseIntent(stripMention(event.content))) {
      log(`🔒 [${key.slice(-12)}] 检测到自然语言关闭意图，触发 close_session: content="${stripMention(event.content).slice(0, 100)}"`);
      closeSessionFromUserIntent(key, "user_natural_language");
      sendReply(event.message_id, "好的，任务已结束 👋");
      return;
    }

    if (pi.waitingTasks.length >= MAX_QUEUE_DEPTH) {
      log(`⚠️ [${key.slice(-12)}] 队列已满 (depth=${pi.waitingTasks.length}), 拒绝 msgId=${event.message_id.slice(-8)}`);
      addReaction(event.message_id, EMOJI_ERROR);
      sendReply(event.message_id, "⚠️ Bot 队列已满，请稍后再试");
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: "n/a",
        operator: event.sender_id,
        operatorName: null,
        state: "terminated",
        reason: "queue_full",
      });
      return;
    }

    // 9. 创建 task（operator 字段：MVP 阶段使用 event.sender_id 作为占位）
    const taskPromptId = nextPromptId(event.message_id);
    const task: PendingTask = {
      promptId: taskPromptId,
      msgId: event.message_id,
      prompt: formatPrompt(event, pi, taskPromptId),
      reactionId: null,
      chatId: event.chat_id,
      createTime: event.create_time,
      attemptCount: 0,
      operator: event.sender_id,
      operatorName: null,
    };

    // 10. WAVE
    task.reactionId = addReaction(event.message_id, EMOJI_READ);
    log(`📩 [${key.slice(-12)}] 入队 msgId=${event.message_id.slice(-8)} promptId=${task.promptId} authorized=${pi.authorized} queue=${pi.waitingTasks.length} active=${pi.activeTask?.promptId ?? "null"} ready=${pi.ready}`);

    // 11. Task journal: in_progress（任务创建并入队 / 立即启动）
    emitTaskJournal({
      eventTime: new Date().toISOString(),
      promptId: task.promptId,
      operator: task.operator,
      operatorName: task.operatorName,
      state: "in_progress",
    });

    // 12. 分流
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