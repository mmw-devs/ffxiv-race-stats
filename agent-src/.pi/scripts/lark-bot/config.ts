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
 * PROJECT_DIR：使用 process.cwd()（项目根）。
 *   不再用 __dirname + N 层相对路径推导，避免目录嵌套层数变化时
 *   ".. 次数没同步减一"类硬编码 bug（B5 防御性重构）。
 *   调用方约定：在仓库根目录下启动 lark-bot（main.ts 注释亦同）。
 */

import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ═══════════════ 项目根与外部依赖 ═══════════════

export const PROJECT_DIR = process.cwd();
export const CLI = join(
  PROJECT_DIR,
  ".pi/npm/node_modules/@larksuite/cli/bin/lark-cli",
);

// 启动期 sanity check：cwd 必须在仓库根（否则 spawn CLI / settings / sessions 全部错位）
// 检查 dev 与 ops 两侧仓库结构（sync 后 ops 仓库没有 agent-src/，dev 仓库有）
const _looksLikeOpsRepoRoot = existsSync(join(PROJECT_DIR, ".pi/scripts/lark-bot/config.ts"));
const _looksLikeDevRepoRoot = existsSync(join(PROJECT_DIR, "agent-src/.pi/scripts/lark-bot/config.ts"));
if (!_looksLikeOpsRepoRoot && !_looksLikeDevRepoRoot) {
  throw new Error(
    `PROJECT_DIR sanity check failed: ${PROJECT_DIR}\n` +
    `  expected cwd to be either dev repo root (with agent-src/) or ops repo root.\n` +
    `  fix: cd into the repository root before launching lark-bot.`,
  );
}

// ═══════════════ 进程与日志 ═══════════════

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

// ═══════════════ 健壮性（pi 子进程重启风暴） ═══════════════

// pi 子进程持续崩溃的检测窗口与阈值：在窗口内超过阈值则停止重试。
// L5 进程级 restart storm（RESTART_STORM_* / CRASH_LOG_PREFIX / HEARTBEAT_INTERVAL_MS /
// HEAP_PRESSURE_MB / HEAP_HARD_LIMIT_MB / PID_FILE）已由 systemd/pm2 接管，不再需要。
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

// 私聊会话配额（与 MAX_SESSIONS 解耦：MAX_SESSIONS 是 per-process 上限，
// MAX_AUTHED_SLOTS 是已鉴权会话的并发上限）。
// 超过此配额时，新增会话走 no_match 分支拒绝（防资源耗尽）。
export const MAX_AUTHED_SLOTS = 10;

// ═══════════════ 群组鉴权（事件驱动 / 零轮询） ═══════════════

// 启动期冷启动调用超时
export const BOOT_GROUP_LIST_TIMEOUT_MS = 5_000;
export const BOOT_GROUP_MEMBERS_TIMEOUT_MS = 5_000;

// 启动后鉴权路径仅走内存，零飞书 API 调用（im.chats.* / im.+chat-members-list）。
// 唯一保留的实时 API：bot 加入新群时补一次 description（im.chat.member.bot.added_v1 触发）
export const NEW_CHAT_GET_INFO_TIMEOUT_MS = 3_000;

// lark-cli EventKey 订阅清单（事件驱动缓存的输入源）
// 必须与飞书开放平台"事件订阅"后台勾选一致；缺失时事件不会推送
export const AUTH_EVENT_KEYS = [
  "im.message.receive_v1",            // 私聊消息接收（业务消息主路径）
  "im.chat.member.bot.added_v1",      // bot 被加入群 → 内存加 chat_id，调 +chat-get 补 description
  "im.chat.member.bot.deleted_v1",    // bot 被移出群 → 内存删除 chat_id
  "im.chat.member.user.added_v1",     // 用户加入群 → 内存加入 openId
  "im.chat.member.user.deleted_v1",   // 用户离开群 → 内存删除 openId
  "im.chat.member.user.withdrawn_v1", // 邀请撤回 → 忽略（不影响已通过成员）
  "im.chat.updated_v1",               // 群信息变更 → payload 含 description → 直接更新内存
  "im.chat.disbanded_v1",             // 群解散 → 内存删除 chat_id
] as const;

// LarkEvent 必要字段白名单：缺失或类型错误的事件直接丢弃。
// 注意：当前架构下 chat_type 只可能是 "p2p"，作为字段校验的一部分。
export const REQUIRED_EVENT_FIELDS = [
  "type", "chat_id", "chat_type", "sender_id", "message_id", "message_type", "content", "create_time",
] as const;

// ═══════════════ 健壮性（L4b 任务状态机） ═══════════════

// waitingTasks 中任务最大等待时长：超时任务在 promoteNext 时丢弃并 ERROR。
// 该值应远大于预期 Agent 处理耗时（数秒到 1 分钟），但小于飞书消息可恢复时间。
export const TASK_MAX_AGE_MS = 30 * 60 * 1000; // 30 分钟

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
