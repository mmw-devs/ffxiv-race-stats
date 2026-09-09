/**
 * extensions/lark-bot/process/log-rotate.ts
 *
 * 依据：issue #168 第一阶段 N4 §3.2.1（process.ts 拆分保留项）
 *
 * 职责（PR-1：从 agent-src/.pi/scripts/lark-bot/process.ts 抽出）：
 *   - 日志文件轮转（LOG_FILE 超过 LOG_MAX_BYTES 时滚动）
 *   - Task Journal 文件轮转（TASK_JOURNAL_FILE 同样策略）
 *   - 追加 Task Journal 条目（JSONL 格式）
 *
 * 这是 shared/logger.ts 的依赖（被单向引用），必须保留。
 *
 * 不在 PR-1 删除项内：
 *   - 日志文件管理是业务关切，不是进程级防护
 *   - 保留在 extensions/lark-bot/process/ 下
 */

import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import {
  LOG_FILE,
  LOG_KEEP_BACKUPS,
  LOG_MAX_BYTES,
  TASK_JOURNAL_FILE,
} from "../../../scripts/lark-bot/config.js";
import type { TaskJournalEntry } from "../../../scripts/lark-bot/shared/types.js";

// ═══════════════ 日志轮转（被 logger 单向调用） ═══════════════

/**
 * 日志文件轮转。
 *
 * 行为：
 *   - LOG_FILE 不存在或未超过 LOG_MAX_BYTES → 直接返回
 *   - 删除最旧的 .LOG_KEEP_BACKUPS 备份
 *   - 滚动中间备份（.i → .i+1）
 *   - 当前 LOG_FILE 滚动到 .1
 *
 * 异常静默吞掉（与 process.ts 原行为一致）。
 */
export function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const stats = statSync(LOG_FILE);
    if (stats.size < LOG_MAX_BYTES) return;
    try { unlinkSync(`${LOG_FILE}.${LOG_KEEP_BACKUPS}`); } catch {}
    for (let i = LOG_KEEP_BACKUPS - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      try { if (existsSync(src)) renameSync(src, dst); } catch {}
    }
    try { renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch {}
  } catch {}
}

// ═══════════════ Task Journal 轮转与追加 ═══════════════

/**
 * Task journal 轮转：与 LOG_FILE 同样策略（LOG_MAX_BYTES / LOG_KEEP_BACKUPS）。
 * 复用同一容量上限与备份数，保证运维侧心智一致。
 */
export function rotateTaskJournalIfNeeded(): void {
  try {
    if (!existsSync(TASK_JOURNAL_FILE)) return;
    const stats = statSync(TASK_JOURNAL_FILE);
    if (stats.size < LOG_MAX_BYTES) return;
    try { unlinkSync(`${TASK_JOURNAL_FILE}.${LOG_KEEP_BACKUPS}`); } catch {}
    for (let i = LOG_KEEP_BACKUPS - 1; i >= 1; i--) {
      const src = `${TASK_JOURNAL_FILE}.${i}`;
      const dst = `${TASK_JOURNAL_FILE}.${i + 1}`;
      try { if (existsSync(src)) renameSync(src, dst); } catch {}
    }
    try { renameSync(TASK_JOURNAL_FILE, `${TASK_JOURNAL_FILE}.1`); } catch {}
  } catch {}
}

/**
 * 追加一条 TaskJournalEntry 到 TASK_JOURNAL_FILE（JSONL 格式，每行一个 JSON 对象）。
 * 写入失败仅吞错，不影响主流程——与 rotateLogIfNeeded 同健壮性策略。
 */
export function appendTaskJournal(entry: TaskJournalEntry): void {
  try {
    rotateTaskJournalIfNeeded();
    appendFileSync(TASK_JOURNAL_FILE, JSON.stringify(entry) + "\n");
  } catch {}
}
