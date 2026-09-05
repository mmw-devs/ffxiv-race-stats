/**
 * shared/logger.ts — lark-bot 日志门面
 *
 * SSOT 原则：所有 lark-bot 内部模块的日志输出必须经过本模块，
 * 保证统一 ISO 时间戳 + 自动轮转 + 文件 /tmp/lark-bot.log 持久化。
 *
 * 设计：纯函数模块，process.ts 负责轮转 + 文件 IO，
 * 其他模块只调用 log() / emitTaskJournal()。
 *
 * 注意：本模块不导入 process.ts（被 process.ts 间接引用 rotateLogIfNeeded），
 * 避免循环依赖。
 */

import { appendFileSync } from "node:fs";

import { LOG_FILE, TASK_JOURNAL_FILE } from "../config.js";
import { rotateLogIfNeeded, rotateTaskJournalIfNeeded } from "../process.js";
import type { PendingTask, TaskJournalEntry } from "./types.js";

export function log(msg: string): void {
  // 完整 ISO 8601（带日期）便于跨天、跨服务排查
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    rotateLogIfNeeded();
    appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

/**
 * 计算 task 自创建以来的存活毫秒数。
 * 原本散落在 task-state-machine.ts 的 6 处复制粘贴（finishTaskWithError /
 * completeActiveTask 多种终止路径 / promoteNext 队列超时），
 * 抽出后统一调用此函数，避免变量名不统一（durationMs / ageMs）。
 */
export function taskDurationMs(task: PendingTask): number {
  return Date.now() - new Date(task.createTime).getTime();
}

/**
 * Task journal 门面：把 TaskJournalEntry 追加到 /tmp/lark-bot-tasks.jsonl。
 * 与 log() 同设计：写入失败仅吞错，不影响主流程；轮转策略复用 LOG_MAX_BYTES。
 */
export function emitTaskJournal(entry: TaskJournalEntry): void {
  try {
    rotateTaskJournalIfNeeded();
    appendFileSync(TASK_JOURNAL_FILE, JSON.stringify(entry) + "\n");
  } catch {}
}

// 导出常量供测试断言
export { TASK_JOURNAL_FILE };