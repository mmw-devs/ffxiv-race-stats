/**
 * shared/types.ts — lark-bot 共享类型定义
 *
 * L4b Interactive 子系统内部使用的核心数据结构。
 * 放在 shared/ 是为了让 session-manager 和 task-state-machine
 * 都能引用而不产生循环依赖。
 *
 * SSOT 视角：所有 lark-bot 内运行时数据结构均在此处定义一次。
 * 新增字段时改这里一处，TypeScript 类型系统会强制所有使用方同步更新。
 */

import type { ChildProcess } from "node:child_process";

/**
 * 单条飞书消息在 lark-bot 侧的完整生命周期对象。
 *   - 创建时机：飞书事件入队（WS 或 poll）
 *   - 状态流转：waitingTasks → activeTask → 完成（DONE/ERROR）
 *   - 严格 1 对 1 绑定 activeTask，避免回复错位
 */
export interface PendingTask {
  promptId: string;          // f-<seq>-<msgId后8位>
  msgId: string;             // 飞书消息 ID
  prompt: string;            // 发送给 pi 的完整内容
  reactionId: string | null; // 当前展示的反应 ID（可能是 WAVE/WAITING/THINKING）
  replyInThread: boolean;
  chatId: string | undefined;
  threadId: string | undefined;
  rootId: string | undefined;
  source: "ws" | "poll";    // 消息来源（WS 实时 / 话题轮询）
  createTime: string | undefined; // 飞书原始时间
  attemptCount: number;      // prompt 投递尝试次数（success:false 时递增重试）
}

/** 单飞取回复文本的等待句柄（completeActiveTask 期间只有一个） */
export interface PendingResultFetch {
  task: PendingTask;
  expectedId: string;          // result-<promptId>
  resolve: (text: string | null) => void;
}

/**
 * pi 子进程会话结构。
 * 存储于 sessions Map（session-manager 拥有），跨模块共享读写。
 */
export interface PiSession {
  proc: ChildProcess | null;   // 注意：重启期会临时为 null
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
}

/**
 * 飞书事件类型（lark-cli event consume NDJSON 解析后的形状）。
 * 定义在 shared/ 是因为 ingress、protocol/feishu、routing 都需要引用。
 */
export interface LarkEvent {
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
  sender_type?: string;       // DIAG-EVT 日志使用（"user" / "app" / "bot" 等）
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

/**
 * TaskReactionView — switchReaction 只依赖这两个字段。
 * 在 protocol/feishu.ts 中定义；放此处仅为说明其作为跨模块契约的稳定形态。
 */
export interface TaskReactionView {
  msgId: string;
  reactionId: string | null;
}
