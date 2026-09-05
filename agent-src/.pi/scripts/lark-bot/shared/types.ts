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
 *
 * 「方向 B：业务流状态机」演进：
 *   - + TaskState（5 值）：业务流在生命周期内的状态
 *   - TaskJournalEntry.outcome → state + subject
 *   - + PendingTask.currentSubject：去重最近一次上报主题
 *   - + TaskLogEvent：agent → lark-bot 的 task_log 事件类型
 */

import type { ChildProcess } from "node:child_process";

/**
 * 单条私聊消息在 lark-bot 侧的完整生命周期对象。
 *   - 创建时机：飞书 p2p 事件入队
 *   - 状态流转：waitingTasks → activeTask → 完成（DONE/ERROR）
 *   - 状态字段语义：state 在 TaskJournalEntry 上记录，task 内部不重复存
 *
 * PR #3 起新增字段：
 *   - operator / operatorName：由 identity-resolver 注入的稳定飞书 user_id
 *     用于 commit message 的 OP_LOG.operator（原样使用，不得推断）
 *
 * 「方向 B」起新增字段：
 *   - currentSubject：最近一次 task_log 上报的 subject（用于去重）
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
  currentSubject?: string;   // 最近一次 task_log 上报的 subject（用于去重）
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

/**
 * Task journal state：业务流在生命周期内的状态。
 *
 * 演进说明：
 *   - pre_business / post_review 已声明但本期未 emit（详见各自 JSDoc）
 *   - in_review 已 rename 为 awaiting_review（语义与 CI 通道 PR前的实现对齐）
 *
 *   - pre_business：过程1，消息收到、p2p 对象未识别
 *   - in_progress：过程2，agent 工作（多轮指正 / 执行 / 生成 commit）
 *   - awaiting_review：过程3，agent 工作周期完成、等下游环节
 *   - post_review：过程4，等用户拍板合并 / 合并完成
 *   - terminated：终态，任意环节失败或用户主动取消
 */
export type TaskState =
  | "pre_business"
  | "in_progress"
  | "awaiting_review"
  | "post_review"
  | "terminated";

/**
 * 过程1，消息收到、p2p 对象未识别。
 *
 * 接线状态：**本期未 emit**。后续如需观测"消息到识别"延迟，
 * 可在 `ingress.handleLarkEvent` 校验前加 emit 点（注意：此时 promptId
 * 还未生成，需用 msgId 占位）。
 */

/**
 * awaiting_review：过程3，agent 工作周期完成、等下游环节（CI 审核 + 用户拍板合并）。
 *
 * 实际触发点：`completeActiveTask` 的 DONE 分支（agent 文本已发到飞书）。
 * 与"过程3 CI 审核中"语义有差距——CI 通道不在 lark-bot 进程内，
 * lark-bot 当前无法感知 CI 状态。完整 CI 通道接入后，本状态名沿用。
 */

/**
 * post_review：过程4，等用户拍板合并 / 合并完成。
 *
 * 接线状态：**本期未 emit**。合并实际由 ops 仓库 CI + GitHub PR UI 承担，
 * lark-bot 不订阅 webhook。后续如需观测"等待合并 → 合并完成"周期，
 * 需引入 webhook 通道。
 */

/**
 * 结构化任务日志条目（追加到 /tmp/lark-bot-tasks.jsonl）。
 * 每次状态跃迁或 agent 上报 subject 时产生一条记录。
 * durationMs 在终止类条目（state=awaiting_review/post_review/terminated）填充。
 */
export interface TaskJournalEntry {
  eventTime: string;          // ISO 8601 UTC
  promptId: string;           // f-<seq>-<msgId后8位>
  operator: string;           // 飞书 user_id（PR #138 注入）
  operatorName: string | null; // OPERATOR_REGISTRY 展示名
  state: TaskState;           // 当前任务状态
  subject?: string;           // agent 通过 task_log 事件上报的业务主题
  durationMs?: number;        // 终止类条目填充
  reason?: string;            // state=terminated 时填原因
}

/**
 * agent → lark-bot 的 task_log 事件类型（pi RPC 通道）。
 * agent 在理解任务主题后向 stdout 输出，lark-bot 收到后写日志。
 *
 * 字段约束：
 *   - promptId：必填，用于 lark-bot 定位 task（即使 activeTask 已清空）
 *   - subject：必填，自由文本业务主题
 */
export interface TaskLogEvent {
  type: "task_log";
  promptId: string;
  subject: string;
}
