/**
 * shared/types.ts — lark-bot 共享类型定义
 *
 * SSOT 视角：所有 lark-bot 内运行时数据结构均在此处定义一次。
 * 新增字段时改这里一处，TypeScript 类型系统会强制所有使用方同步更新。
 *
 * 「群聊=广播 / 私聊=业务」方向下的精简形态：
 *   - LarkEvent 移除 thread/mentions/sender_type（p2p 不存在这些概念）
 *   - PendingTask 移除 source（无 ws/poll 双源）
 *   - sendReply 移除 replyInThread（无 thread）
 *   - seedMessages 已废弃（thread 激活机制随群聊 session 一并剔除）
 */

import type { ChildProcess } from "node:child_process";

/**
 * 单条私聊消息在 lark-bot 侧的完整生命周期对象。
 *   - 创建时机：飞书 p2p 事件入队
 *   - 状态流转：waitingTasks → activeTask → 完成（DONE/ERROR）
 *
 * PR #3 起新增字段：
 *   - operator / operatorName：由 identity-resolver 注入的稳定飞书 user_id
 *     用于 commit message 的 OP_LOG.operator（原样使用，不得推断）
 */
export interface PendingTask {
  promptId: string;          // f-<seq>-<msgId后8位>
  msgId: string;             // 飞书消息 ID
  prompt: string;            // 发送给 pi 的完整内容
  reactionId: string | null; // 当前展示的反应 ID
  chatId: string;            // 飞书 chat_id（p2p 固定值）
  createTime: string;        // 飞书原始时间
  attemptCount: number;      // prompt 投递尝试次数（success:false 时递增重试）
  operator: string;          // 飞书 user_id（lark-bot 解析后注入）
  operatorName: string | null; // OPERATOR_REGISTRY 中的展示名
}

/** 单飞取回复文本的等待句柄（completeActiveTask 期间只有一个） */
export interface PendingResultFetch {
  task: PendingTask;
  expectedId: string;          // result-<promptId>
  resolve: (text: string | null) => void;
}

/**
 * pi 子进程会话结构。当前架构下每 p2p chat 一个独立 session。
 * 各 session 的 state 完全独立（activeTask / waitingTasks / dedup / pi process）。
 */
export interface PiSession {
  /** 唯一标识（与 sessions Map 的 key 相同） */
  key: string;
  /** 关联的飞书 chat_id（p2p 会话专用；未来 broadcast 复用） */
  chatId: string;
  /** 最后一次活动时间戳（ms），用于空闲淘汰 */
  lastActivityAt: number;
  proc: ChildProcess | null;   // 注意：重启期会临时为 null
  ready: boolean;
  /** 当前正在处理的任务（同一会话同一时间最多 1 个） */
  activeTask: PendingTask | null;
  /** FIFO 等待队列 */
  waitingTasks: PendingTask[];
  /** 已入队消息 ID（msgId → 首次加入时间戳 Date.now()，用于 TTL + LRU 淘汰） */
  seenMessageIds: Map<string, number>;
  /** 正在取 last_assistant_text + 发回复（防重入） */
  finishing: boolean;
  /** 单飞取文本的等待句柄（completeActiveTask 期间最多 1 个） */
  pendingResultFetch: PendingResultFetch | null;
}

/**
 * 飞书 p2p 事件类型（lark-cli event consume NDJSON 解析后的形状）。
 * 群聊事件不在此类型范围内——ingress 会直接丢弃群聊事件。
 */
export interface LarkEvent {
  type: string;
  chat_id: string;
  chat_type: "p2p";          // 当前架构下只可能是 p2p
  sender_id: string;
  message_id: string;
  message_type: string;       // 当前仅处理 "text"
  content: string;
  create_time: string;
}

/**
 * sendReplyGetId 结构化返回：不重试、不重发，失败走 ERROR。
 */
export interface SendReplyResult {
  ok: boolean;
  replyId: string | null;
  error?: string;
  timedOut?: boolean;
}
