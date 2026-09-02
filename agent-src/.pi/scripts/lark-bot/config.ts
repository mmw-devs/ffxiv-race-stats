/**
 * config.ts — L0 Config 层（启动期不可变单一源）
 *
 * SSOT 原则：所有「时间观/容量观/身份信息」常量集中在此。
 * 运行时禁止二次读取 process.env 或硬编码默认值。
 *
 * PROJECT_DIR 计算：lark-bot/ 目录下文件距 agent-src/ 项目根共 4 层
 *   config.ts → lark-bot/ → scripts/ → .pi/ → agent-src/
 */

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════ 项目根与外部依赖 ═══════════════

export const PROJECT_DIR = join(__dirname, "..", "..", "..", "..");
export const CLI = join(
  PROJECT_DIR,
  ".pi/npm/node_modules/@larksuite/cli/bin/lark-cli",
);

// ═══════════════ 进程与日志 ═══════════════

export const PID_FILE = join(tmpdir(), "lark-bot.pid");
export const LOG_FILE = join(tmpdir(), "lark-bot.log");

export const LOG_MAX_BYTES = 50 * 1024 * 1024;
export const LOG_KEEP_BACKUPS = 5;

// ═══════════════ 进程启动 ═══════════════

export const PI_BIN = process.env.PI_BIN || "pi";
export const IS_WIN = process.platform === "win32";

// ═══════════════ Bot 身份 ═══════════════

export const BOT_OPEN_ID = process.env.LARK_BOT_OPEN_ID || "ou_f284b18bf12c193bf5a942a273c5cbf0";
export const BOT_NAME = process.env.LARK_BOT_NAME || "FFXIV 竞速";

// ═══════════════ 表情协议 ═══════════════

export const EMOJI_READ = "WAVE";
export const EMOJI_WAITING = "OnIt";
export const EMOJI_THINKING = "THINKING";
export const EMOJI_DONE = "DONE";
export const EMOJI_ERROR = "ERROR";

// ═══════════════ 超时与限额 ═══════════════

export const REPLY_SEND_TIMEOUT_MS = 18_000;       // sendReplyGetId 单次超时
export const TEXT_FETCH_TIMEOUT_MS = 20_000;       // get_last_assistant_text 等待超时
export const THREAD_TTL_MS = 30 * 60 * 1000;      // thread 激活态有效期
export const SEEN_TTL_MS = 24 * 60 * 60 * 1000;   // seenMessageIds TTL 24h
export const SEEN_MAX_SIZE = 5000;                // seenMessageIds 容量上限

// ═══════════════ 会话文件清理 ═══════════════

export const SESSION_MAX_AGE_DAYS = 30;
export const SESSION_KEEP_PER_CHAT = 5;
export const SESSION_ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

// ═══════════════ 代理注入（启动期一次性） ═══════════════

if (!process.env.HTTP_PROXY) {
  try {
    const s = JSON.parse(readFileSync(join(PROJECT_DIR, ".pi/settings.json"), "utf-8"));
    if (s.proxy) {
      process.env.HTTP_PROXY = s.proxy;
      process.env.HTTPS_PROXY = s.proxy;
    }
  } catch {}
}
