/**
 * extensions/lark-bot/process/session-cleanup.ts
 *
 * 依据：issue #168 第一阶段 N4 §3.3（process.ts 拆分保留项）
 *
 * 职责（PR-1：从 agent-src/.pi/scripts/lark-bot/process.ts 抽出）：
 *   定期清理 .pi/sessions/bot-* 下旧的 jsonl 文件。
 *   清理规则（保持原 process.ts cleanupOldSessions 行为零变化）：
 *     - 超过 SESSION_KEEP_PER_CHAT 的最旧文件
 *     - 超过 SESSION_MAX_AGE_DAYS 的文件
 *     - 但最近 SESSION_ACTIVE_THRESHOLD_MS 内活跃的保留
 *
 * 不在 PR-1 删除项内：
 *   - 这是业务关切（session 文件管理），不是进程级防护
 *   - 因此保留在 extensions/lark-bot/process/ 下
 */

import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  PROJECT_DIR,
  SESSION_ACTIVE_THRESHOLD_MS,
  SESSION_KEEP_PER_CHAT,
  SESSION_MAX_AGE_DAYS,
} from "../../../scripts/lark-bot/config.js";

// ═══════════════ session 文件清理 ═══════════════

/**
 * 清理 .pi/sessions/ 下旧的 jsonl 文件。
 *
 * 行为（保持 process.ts 原实现）：
 *   - 遍历 SESSION_ROOT 下所有子目录
 *   - 每个子目录下收集 .jsonl 文件，按 mtime 倒序
 *   - 删除超出 SESSION_KEEP_PER_CHAT 或超过 SESSION_MAX_AGE_DAYS 的文件
 *   - 但最近 SESSION_ACTIVE_THRESHOLD_MS 内活跃的保留
 *   - 异常静默吞掉（不阻断业务）
 *
 * @returns 删除的文件数量
 */
export function cleanupOldSessions(): number {
  const sessionRoot = join(PROJECT_DIR, ".pi", "sessions");
  const now = Date.now();
  const maxAgeMs = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  let chatDirs: string[];
  try {
    chatDirs = readdirSync(sessionRoot);
  } catch {
    // sessionRoot 不存在（首次启动）——非错误
    return 0;
  }

  for (const chatDir of chatDirs) {
    const dirPath = join(sessionRoot, chatDir);
    let st;
    try {
      st = statSync(dirPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const entries = readdirSync(dirPath)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const p = join(dirPath, f);
        let mt = 0;
        try {
          mt = statSync(p).mtimeMs;
        } catch {
          // 静默
        }
        return { name: f, path: p, mtime: mt };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const isBeyondKeep = i >= SESSION_KEEP_PER_CHAT;
      const isTooOld = now - e.mtime > maxAgeMs;
      const isRecent = now - e.mtime < SESSION_ACTIVE_THRESHOLD_MS;
      if ((isBeyondKeep || isTooOld) && !isRecent) {
        try {
          unlinkSync(e.path);
          removed++;
        } catch {
          // 静默
        }
      }
    }
  }

  if (removed > 0) {
    // 与 process.ts 原行为一致：仅在有删除时输出日志
    console.log(`🧹 [session cleanup] removed ${removed} old files (>${SESSION_MAX_AGE_DAYS}d or beyond top-${SESSION_KEEP_PER_CHAT})`);
  }

  return removed;
}

/**
 * 启动周期清理定时器。
 *
 * 用法（PR-1：在 extensions/lark-bot/index.ts session_start 时调用）：
 *   const timer = startSessionCleanupInterval();
 *   // session_shutdown 时：
 *   clearInterval(timer);
 *
 * @param intervalMs 清理周期，默认 24h（与 process.ts 原行为一致）
 * @returns NodeJS.Timeout 句柄
 */
export function startSessionCleanupInterval(intervalMs: number = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    cleanupOldSessions();
  }, intervalMs);
}
