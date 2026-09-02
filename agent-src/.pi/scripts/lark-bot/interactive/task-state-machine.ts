/**
 * interactive/task-state-machine.ts — L4b Interactive / 任务状态机
 *
 * SSOT 视角：
 *   - 每条飞书消息对应的 PendingTask 走完以下状态机：
 *       waiting (in queue) → active (THINKING) → settled (DONE | ERROR)
 *   - 本模块仅在 settled 阶段介入（completeActiveTask / finishTaskWithError）
 *   - waiting → active 阶段由 session-manager.startTask 负责
 *   - waiting → 重新 waiting 由 session-manager 的 prompt 失败重试路径负责
 *
 * 约束（已送 Agent 不得重放）：
 *   - finishTaskWithError 调用点仅限 prompt 二次被拒（attempts > 0）。
 *     Agent 内部阶段的错误统一走 completeActiveTask（agent_settled 后），
 *     该路径不重发 prompt，也不重投该任务。
 *   - 不再将 task 推回 waitingTasks，避免错误任务被重新 pop 启动。
 */

import {
  EMOJI_DONE,
  EMOJI_ERROR,
  EMOJI_THINKING,
  EMOJI_WAITING,
  REPLY_SEND_TIMEOUT_MS,
  TEXT_FETCH_TIMEOUT_MS,
} from "../config.js";
import type { PiSession, PendingTask } from "../shared/types.js";
import { log } from "../shared/logger.js";
import { sendReply, sendReplyGetId, switchReaction } from "../protocol/feishu.js";

// ═══════════════ 任务异常结束 ═══════════════

/**
 * 任务异常结束（用于 prompt 二次被拒 / 其他本地不可恢复错误）：
 *   ERROR 表情 → 结构化日志（promptId/msgId/source/reason）→ 飞书错误回复
 *   → 若为 activeTask 则清空 + finishing=false + promoteNext
 */
export function finishTaskWithError(pi: PiSession, task: PendingTask, reason: string): void {
  log(`⛔ [${task.promptId}] ERROR: msgId=${task.msgId.slice(-8)} source=${task.source} reason=${reason}`);
  switchReaction(task, EMOJI_ERROR);
  const errText = `❌ 处理失败：${reason}\n请重试或联系管理员。`;
  try {
    sendReply(task.msgId, errText, task.replyInThread);
  } catch (e: any) {
    log(`回复 ERROR 失败: ${e?.message?.slice(0, 80)}`);
  }
  if (pi.activeTask?.promptId === task.promptId) {
    pi.activeTask = null;
    pi.finishing = false; // 防御性：避免异常路径下 finishing 残留
    promoteNext(pi);
  } else {
    log(`⚠ finishTaskWithError 时 activeTask 不匹配: active=${pi.activeTask?.promptId ?? "null"} task=${task.promptId}`);
    // 即使不匹配，也确保 finishing 复位（极端并发场景的兜底）
    pi.finishing = false;
  }
}

// ═══════════════ 任务正常完成 ═══════════════

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
export async function completeActiveTask(pi: PiSession): Promise<void> {
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

// ═══════════════ seedMessages 共享状态 ═══════════════

/**
 * seedMessages：被用于 shouldHandle 的"激活根消息所在 thread"判定。
 * 物理位置在 task-state-machine 是因为只有 completeActiveTask 成功 DONE 时才添加。
 * access 由 ingress 引用。
 */
export const seedMessages = new Set<string>();

// ═══════════════ 任务入队 / 启动 / 晋升 ═══════════════

/**
 * 启动处理一个任务：占位 activeTask、切换到 THINKING 表情、向 pi 投递 prompt。
 * 投递成功/失败由 pi RPC 的 prompt 响应决定（成功 → 等 agent_settled；失败 → attemptCount++ 重试）。
 *
 * 由 session-manager.handlePiEvent 的 prompt 失败重试路径调用，
 * 以及 promoteNext 从队列取出时调用。
 */
export function startTask(pi: PiSession, task: PendingTask): void {
  pi.activeTask = task;
  switchReaction(task, EMOJI_THINKING);
  const line = JSON.stringify({ type: "prompt", id: task.promptId, message: task.prompt });
  pi.proc?.stdin?.write(line + "\n");
  log(`🚀 startTask promptId=${task.promptId} msgId=${task.msgId.slice(-8)} source=${task.source} queue=${pi.waitingTasks.length}`);
}

/**
 * 从 waitingTasks 队首取下一个任务启动。
 *   - 有任务：startTask（自动占位 activeTask + 切表情 + 投 prompt）
 *   - 队列空：activeTask 保持 null，会话进入空闲
 *   - activeTask 非空时拒绝调用（防御性，避免覆盖正在处理的任务）
 */
export function promoteNext(pi: PiSession): void {
  if (pi.activeTask) {
    log(`⚠ promoteNext 但 activeTask 非空: ${pi.activeTask.promptId}（跳过）`);
    return;
  }
  const next = pi.waitingTasks.shift();
  if (!next) {
    log(`💤 队列空，session 空闲`);
    return;
  }
  startTask(pi, next);
}

/**
 * 把 task 放进 waitingTasks 队列（activeTask 满时）。
 * 由 ingress.handleLarkEvent 调用。
 */
export function enqueueTask(pi: PiSession, task: PendingTask): void {
  pi.waitingTasks.push(task);
}

/**
 * 把任务标记为 activeTask 并立即启动（activeTask 空时）。
 * 由 ingress.handleLarkEvent 调用。
 */
export function startImmediate(pi: PiSession, task: PendingTask): void {
  startTask(pi, task);
}
