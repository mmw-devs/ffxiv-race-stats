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
export const TASK_JOURNAL_FILE = join(tmpdir(), "lark-bot-tasks.jsonl");

export const LOG_MAX_BYTES = 50 * 1024 * 1024;
export const LOG_KEEP_BACKUPS = 5;

// ═══════════════ 进程启动 ═══════════════

export const PI_BIN = process.env.PI_BIN || "pi";
export const IS_WIN = process.platform === "win32";

// ═══════════════ Bot 身份 ═══════════════

export const BOT_OPEN_ID = process.env.LARK_BOT_OPEN_ID || "ou_f284b18bf12c193bf5a942a273c5cbf0";
export const BOT_NAME = process.env.LARK_BOT_NAME || "FFXIV 竞速";

// ═══════════════ 身份解析（PR #3） ═══════════════

/** identity provider 固定为 feishu-contact（迁移至 identity-resolver.ts） */
export const IDENTITY_PROVIDER = "feishu-contact" as const;

/** canonicalClaim 固定为 user_id（飞书稳定标识） */
export const IDENTITY_CANONICAL_CLAIM = "user_id" as const;

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

// ═══════════════ 多 session 管理（commit 4：per-p2p session） ═══════════════

// 空闲 session 淘汰阈值：无活动超过此时长则销毁（释放 pi 子进程 + 内存）
// 下次该 chat_id 来消息时按懒启动重建
export const IDLE_SESSION_TIMEOUT_MS = 60 * 60 * 1000;

// session 数量上限：超过则按 LRU 淘汰最久未活动的
// 防止单 lark-bot 进程被滥发 chat_id 拖入资源耗尽
export const MAX_SESSIONS = 10;

// 空闲扫描周期（5 分钟）：周期性检查并淘汰空闲 session
// 周期设短可更早回收，但增加心跳日志噪音
export const SESSION_EVICTION_INTERVAL_MS = 5 * 60 * 1000;

// ═══════════════ 健壮性（L1 Protocol 熔断器） ═══════════════

// 飞书 API 连续失败 N 次则熔断 M 秒，避免雪崩（耗尽配额 / 网络持续抖动）。
export const CIRCUIT_BREAKER_THRESHOLD = 5;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

// ═══════════════ 健壮性（L2 Ingress 反压与输入校验） ═══════════════

// waitingTasks 队列深度上限：超过则拒绝新消息并发 ERROR 表情。
export const MAX_QUEUE_DEPTH = 100;

// ═══════════════ 私聊侧 MVP（会话分类配额） ═══════════════

// 私聊会话分类配额（与 MAX_SESSIONS 解耦：MAX_SESSIONS 是 per-process 上限，
// MAX_P2P_TEMP_SLOTS + MAX_P2P_BUSINESS_SLOTS 是按会话类型分类配额）
// 业务私聊配额 = MAX_P2P_SESSIONS - MAX_P2P_TEMP_SLOTS（隐含 = 9）
export const MAX_P2P_TEMP_SLOTS = 1;
export const MAX_P2P_BUSINESS_SLOTS = 9;

// 鉴权窗口：临时私聊最长存活时间（ms）
export const P2P_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

// 鉴权窗口：临时私聊最多接收用户消息数（agent 上限）
export const P2P_AUTH_MAX_ROUNDS = 2;

// 业务私聊空闲超时（ms）：3 天无活跃则由 60s 清理器关闭
export const P2P_IDLE_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000;

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
