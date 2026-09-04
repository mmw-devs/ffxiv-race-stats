/**
 * interactive/task-state-machine.ts — L4b Interactive / 任务状态机
 *
 * SSOT 视角：
 *   - 每条飞书 p2p 消息对应的 PendingTask 走完以下状态机：
 *       waiting (in queue) → active (THINKING) → settled (DONE | ERROR)
 *   - 本模块在 waiting → active 由 startTask 介入（启动 + 投 prompt）
 *   - 本模块在 settled 阶段介入（completeActiveTask / finishTaskWithError）
 *
 * 约束（已送 Agent 不得重放）：
 *   - finishTaskWithError 调用点仅限 prompt 二次被拒（attempts > 0）。
 *   - 不再将 task 推回 waitingTasks，避免错误任务被重新 pop 启动。
 *
 * 「群聊=广播」重构后移除的功能：
 *   - seedMessages 已删除（thread 激活机制随群聊 session 一并剔除）
 *   - replyInThread 参数已删除（p2p 不存在 thread 回复）
 */

import {
  EMOJI_DONE,
  EMOJI_ERROR,
  EMOJI_THINKING,
  REPLY_SEND_TIMEOUT_MS,
  TASK_MAX_AGE_MS,
  TEXT_FETCH_TIMEOUT_MS,
} from "../config.js";
import type { PiSession, PendingTask } from "../shared/types.js";
import { log } from "../shared/logger.js";
import { emitTaskJournal } from "../shared/logger.js";
import { sendReply, sendReplyGetId, switchReaction } from "../protocol/feishu.js";

// ═══════════════ 任务异常结束 ═══════════════

/**
 * 任务异常结束（用于 prompt 二次被拒 / 其他本地不可恢复错误）：
 *   ERROR 表情 → 结构化日志（promptId/msgId/reason）→ 飞书错误回复
 *   → 若为 activeTask 则清空 + finishing=false + promoteNext
 */
export function finishTaskWithError(pi: PiSession, task: PendingTask, reason: string): void {
  log(`⛔ [${task.promptId}] ERROR: msgId=${task.msgId.slice(-8)} reason=${reason}`);
  switchReaction(task, EMOJI_ERROR);
  const errText = `❌ 处理失败：${reason}\n请重试或联系管理员。`;
  try {
    sendReply(task.msgId, errText);
  } catch (e: any) {
    log(`回复 ERROR 失败: ${e?.message?.slice(0, 80)}`);
  }
  // Task journal: aborted（含 durationMs）
  const durationMs = Date.now() - new Date(task.createTime).getTime();
  emitTaskJournal({
    eventTime: new Date().toISOString(),
    promptId: task.promptId,
    operator: task.operator,
    operatorName: task.operatorName,
    outcome: "aborted",
    durationMs,
    reason,
  });
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
  // R4 L4b：检查 activeTask 是否已超时（例：pi 卡住很久才发 agent_settled）
  // 超过 TASK_MAX_AGE_MS 直接 ERROR 收尾，不等 prompt 响应
  const ageMs = Date.now() - new Date(task.createTime).getTime();
  if (Number.isFinite(ageMs) && ageMs > TASK_MAX_AGE_MS) {
    log(`⛔ [${task.promptId}] ERROR: activeTask 超过最大存活时间 (${Math.round(ageMs / 1000)}s > ${TASK_MAX_AGE_MS / 1000}s), 强制收尾`);
    switchReaction(task, EMOJI_ERROR);
    try { sendReply(task.msgId, `❌ 处理超时（超过 ${TASK_MAX_AGE_MS / 1000}s），请重试`); } catch {}
    // Task journal: aborted（activeTask 超时）
    emitTaskJournal({
      eventTime: new Date().toISOString(),
      promptId: task.promptId,
      operator: task.operator,
      operatorName: task.operatorName,
      outcome: "aborted",
      durationMs: ageMs,
      reason: "activeTask_timeout",
    });
    pi.activeTask = null;
    pi.finishing = false;
    promoteNext(pi);
    return;
  }
  pi.finishing = true;

  const fetchId = `result-${task.promptId}`;

  // 3+4：发请求并 await 响应（或超时）
  const fetched = new Promise<string | null>((resolve) => {
    pi.pendingResultFetch = { task, expectedId: fetchId, resolve };
  });
  const timeoutHit = new Promise<"__TIMEOUT__">((resolve) =>
    setTimeout(() => resolve("__TIMEOUT__"), TEXT_FETCH_TIMEOUT_MS),
  );
  pi.proc?.stdin?.write(JSON.stringify({ type: "get_last_assistant_text", id: fetchId }) + "\n");
  log(`🔍 [${task.promptId}] 请求 get_last_assistant_text msgId=${task.msgId.slice(-8)} fetchId=${fetchId} timeout=${TEXT_FETCH_TIMEOUT_MS}ms`);

  const raw = await Promise.race([fetched, timeoutHit]);
  pi.pendingResultFetch = null;
  const text = (typeof raw === "string" && raw !== "__TIMEOUT__") ? raw.trim() : null;

  // 5+6：处理文本 + 发回复
  if (!text) {
    const reason = raw === "__TIMEOUT__" ? "agent 返回文本超时" : "agent 未返回文本";
    log(`⛔ [${task.promptId}] ERROR msgId=${task.msgId.slice(-8)} reason=${reason}`);
    switchReaction(task, EMOJI_ERROR);
    try { sendReply(task.msgId, `❌ 处理失败：${reason}`); } catch (e: any) {
      log(`回复 ERROR 失败: ${e?.message?.slice(0, 80)}`);
    }
    // Task journal: aborted（agent 超时未返回文本）
    const durationMs = Date.now() - new Date(task.createTime).getTime();
    emitTaskJournal({
      eventTime: new Date().toISOString(),
      promptId: task.promptId,
      operator: task.operator,
      operatorName: task.operatorName,
      outcome: "aborted",
      durationMs,
      reason,
    });
  } else {
    log(`📝 [${task.promptId}] 收到 agent 文本 msgId=${task.msgId.slice(-8)} len=${text.length}`);
    // 发送飞书回复（sendReplyGetId 内置超时，结果不明确走 ERROR + 日志，不重发）
    const result = await sendReplyGetId(task.msgId, text);
    if (result.ok && result.replyId) {
      log(`✅ [${task.promptId}] DONE msgId=${task.msgId.slice(-8)} replyId=${result.replyId.slice(-8)} text.len=${text.length} content="${text.slice(0, 50)}"`);
      switchReaction(task, EMOJI_DONE);
      // Task journal: merged（业务流完成）
      const durationMs = Date.now() - new Date(task.createTime).getTime();
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: task.promptId,
        operator: task.operator,
        operatorName: task.operatorName,
        outcome: "merged",
        durationMs,
      });
    } else {
      const reason = result.timedOut ? `回复超时（${REPLY_SEND_TIMEOUT_MS}ms）` : (result.error || "未知错误");
      log(`⛔ [${task.promptId}] ERROR msgId=${task.msgId.slice(-8)} timedOut=${result.timedOut ?? false} reason=${reason}`);
      switchReaction(task, EMOJI_ERROR);
      // Task journal: aborted（reply 失败）
      const durationMs = Date.now() - new Date(task.createTime).getTime();
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: task.promptId,
        operator: task.operator,
        operatorName: task.operatorName,
        outcome: "aborted",
        durationMs,
        reason: `reply_${reason}`,
      });
    }
  }

  // 7+8：清理 + 晋升
  pi.activeTask = null;
  pi.finishing = false;
  promoteNext(pi);
}

// ═══════════════ 任务入队 / 启动 / 晋升 ═══════════════

/**
 * 启动处理一个任务：占位 activeTask、切换到 THINKING 表情、向 pi 投递 prompt。
 * 投递成功/失败由 pi RPC 的 prompt 响应决定（成功 → 等 agent_settled；失败 → attemptCount++ 重试）。
 *
 * 由 session-manager.handlePiEvent 的 prompt 失败重试路径调用，
 * 以及 promoteNext 从队列取出时调用。
 */
export function startTask(pi: PiSession, task: PendingTask): void {
  // R4 L4b：状态机不变量校验 — 同一 session 同一时间只能有 1 个 activeTask
  if (pi.activeTask) {
    log(`🚨 [startTask] 不变量违反: activeTask=${pi.activeTask.promptId} 已存在，但被请求启动 task=${task.promptId}。强制清空旧 task 并 ERROR 收尾。`);
    try { switchReaction(pi.activeTask, EMOJI_ERROR); } catch {}
  }
  pi.activeTask = task;
  switchReaction(task, EMOJI_THINKING);
  const line = JSON.stringify({ type: "prompt", id: task.promptId, message: task.prompt });
  pi.proc?.stdin?.write(line + "\n");
  log(`🚀 startTask promptId=${task.promptId} msgId=${task.msgId.slice(-8)} queue=${pi.waitingTasks.length}`);
}

/**
 * 从 waitingTasks 队首取下一个任务启动。
 *   - 有任务：startTask（自动占位 activeTask + 切表情 + 投 prompt）
 *   - 队列空：activeTask 保持 null，会话进入空闲
 *   - activeTask 非空时拒绝调用（防御性，避免覆盖正在处理的任务）
 *
 * R4 L4b：取出时检查任务年龄。超过 TASK_MAX_AGE_MS 的任务视为已死（运营者可能早已放弃），
 * 直接 ERROR 收尾并丢弃，不入 activeTask。
 */
export function promoteNext(pi: PiSession): void {
  if (pi.activeTask) {
    log(`⚠ promoteNext 但 activeTask 非空: ${pi.activeTask.promptId}（跳过）`);
    return;
  }
  // 反复 shift 直到拿到未超时任务或队列空
  while (pi.waitingTasks.length > 0) {
    const next = pi.waitingTasks.shift()!;
    const ageMs = Date.now() - new Date(next.createTime).getTime();
    if (Number.isFinite(ageMs) && ageMs > TASK_MAX_AGE_MS) {
      log(`⏰ [${next.promptId}] 任务超时丢弃: ${Math.round(ageMs / 1000)}s > ${TASK_MAX_AGE_MS / 1000}s, msgId=${next.msgId.slice(-8)}`);
      switchReaction(next, EMOJI_ERROR);
      try { sendReply(next.msgId, `❌ 任务排队超时（超过 ${TASK_MAX_AGE_MS / 1000}s），已丢弃。请重新发送。`); } catch {}
      // Task journal: aborted（队列内超时）
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: next.promptId,
        operator: next.operator,
        operatorName: next.operatorName,
        outcome: "aborted",
        durationMs: ageMs,
        reason: "queue_timeout",
      });
      continue; // 检查下一个
    }
    startTask(pi, next);
    return;
  }
  log(`💤 队列空，session 空闲`);
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
