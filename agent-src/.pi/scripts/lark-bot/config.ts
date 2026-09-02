/**
 * config.ts — L0 Config 层（启动期不可变单一源）
 *
 * SSOT 原则：所有「时间观/容量观/身份信息」常量集中在此。
 * 运行时禁止二次读取 process.env 或硬编码默认值。
 *
 * 「群聊=广播」重构后移除的常量：
 *   - THREAD_TTL_MS（thread 激活态不再需要）
 *   - EMOJI_WAITING（无排队概念，群聊不进入 active session）
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
export const EMOJI_THINKING = "THINKING";
export const EMOJI_DONE = "DONE";
export const EMOJI_ERROR = "ERROR";

// ═══════════════ 超时与限额 ═══════════════

export const REPLY_SEND_TIMEOUT_MS = 18_000;       // sendReplyGetId 单次超时
export const TEXT_FETCH_TIMEOUT_MS = 20_000;       // get_last_assistant_text 等待超时
export const SEEN_TTL_MS = 24 * 60 * 60 * 1000;   // seenMessageIds TTL 24h
export const SEEN_MAX_SIZE = 5000;                // seenMessageIds 容量上限

// ═══════════════ 会话文件清理 ═══════════════

export const SESSION_MAX_AGE_DAYS = 30;
export const SESSION_KEEP_PER_CHAT = 5;
export const SESSION_ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

// ═══════════════ 健壮性（L5 进程级防护） ═══════════════

// 进程级异常处理：uncaughtException / unhandledRejection 不直接 exit，
// 而是 log + cleanup + exit(1)，给 systemd 留下明确的 non-zero 退出码
// 以便上层 supervisor 决定是否拉起。
export const CRASH_LOG_PREFIX = "💥 CRASH";

// 心跳日志周期，用于运维侧确认 lark-bot 进程确实活着。
export const HEARTBEAT_INTERVAL_MS = 60_000;

// 内存压力阈值（MB）：超过则输出告警日志（不主动重启，避免状态丢失）。
export const HEAP_PRESSURE_MB = 500;

// 硬内存上限（MB）：超过则主动清理 seenMessageIds 等可释放资源，避免 OOM。
// 高于 HEAP_PRESSURE_MB 是"软告警"，这里是"硬动作"阈值。
export const HEAP_HARD_LIMIT_MB = 800;

// ═══════════════ 健壮性（pi 子进程重启风暴） ═══════════════

// pi 子进程持续崩溃的检测窗口与阈值：在窗口内超过阈值则停止重试。
// 与 L5 RESTART_STORM_MAX 的区别：
//   - RESTART_STORM_MAX 限制的是 lark-bot 进程级重启（由 supervisor 拉起）
//   - PI_RESTART_MAX 限制的是单次 lark-bot 运行内的 pi 子进程重启
export const PI_RESTART_WINDOW_MS = 5 * 60 * 1000;
export const PI_RESTART_MAX = 10;
export const PI_RESTART_HISTORY_FILE = join(tmpdir(), "lark-bot.pi-restart-history");

// ═══════════════ 健壮性（L1 Protocol 熔断器） ═══════════════

// 飞书 API 连续失败 N 次则熔断 M 秒，避免雪崩（耗尽配额 / 网络持续抖动）。
export const CIRCUIT_BREAKER_THRESHOLD = 5;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

// ═══════════════ 健壮性（L2 Ingress 反压与输入校验） ═══════════════

// waitingTasks 队列深度上限：超过则拒绝新消息并发 ERROR 表情。
export const MAX_QUEUE_DEPTH = 100;

// LarkEvent 必要字段白名单：缺失或类型错误的事件直接丢弃。
// 注意：当前架构下 chat_type 只可能是 "p2p"，作为字段校验的一部分。
export const REQUIRED_EVENT_FIELDS = [
  "type", "chat_id", "chat_type", "sender_id", "message_id", "message_type", "content", "create_time",
] as const;

// ═══════════════ 健壮性（L4b 任务状态机） ═══════════════

// waitingTasks 中任务最大等待时长：超时任务在 promoteNext 时丢弃并 ERROR。
// 该值应远大于预期 Agent 处理耗时（数秒到 1 分钟），但小于飞书消息可恢复时间。
export const TASK_MAX_AGE_MS = 30 * 60 * 1000; // 30 分钟

// ═══════════════ 健壮性（L5 重启风暴保护） ═══════════════

// 短时间内多次重启则暂停，避免「重启→挂→重启」循环耗资源。
export const RESTART_HISTORY_FILE = join(tmpdir(), "lark-bot.restart-history");
export const RESTART_STORM_WINDOW_MS = 5 * 60 * 1000;
export const RESTART_STORM_MAX = 3;
export const RESTART_STORM_COOLDOWN_MS = 5 * 60 * 1000;

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
