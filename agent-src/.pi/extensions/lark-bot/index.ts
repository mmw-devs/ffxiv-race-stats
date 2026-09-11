/**
 * lark-bot extension — PR-1 编码落地（issue#168 N4 §3.1.2）
 *
 * 路径：extensions/lark-bot/index.ts
 *
 * 设计依据：
 *   - N3 spawn vs extension 对比（方案 G——保留 per-chat spawn）
 *   - N4 §3.5 extension 改造骨架
 *   - 实测 1（ctx.chatId NOT FOUND → chatToSession Map 反查）
 *   - 实测 2（NDJSON 协议稳定，spawn 模式保留）
 *   - 实测 3（lark-cli 输出在 stderr，同时监听）
 *   - 实测 5（陈旧读竞态，禁止 check-then-act）
 *   - 实测 6-1~6-6（6 处实测修正）
 *
 * 与 PR-1 之前的关键差异：
 *   1. PR-1 起 lark-bot 即当前 extension 进程（不再 spawn 独立 lark-bot 进程）
 *   2. 保留「spawn per-chat PI Agent 子进程」（方案 G）
 *   3. PR-1 新增 7 个 registerTool（feishu_*）
 *   4. PR-2 新增 4 个 registerTool（larkbot_* 鉴权 + identity）
 *   5. PR-4 新增 4 个 registerTool（larkbot_* 任务日志）
 *   6. children-registry.ts 跟踪所有子进程（实测 6-3）
 *   7. session_shutdown 手动 kill（实测 6-3）
 *   8. issue#184 恢复双域会话机制：sessionKinds（p2p-temp / p2p-business）+ slot swap + 鉴权窗口 + 60s 周期清理器
 *
 * Feature flag（settings.json larkBot.*）：
 *   - autoStart：主开关，默认 false。false → 本 extension 不启动任何 lark-bot 逻辑。
 *   - useExtensionMode：启动路径选择，默认 false。
 *       false → 启动独立 lark-bot 进程（main.ts 回滚路径，与 PR-1 之前完全一致）
 *       true  → 当前 extension 进程即 lark-bot，registerTool 直接可用
 *
 * 组合行为表：
 *
 *   | autoStart | useExtensionMode | 行为                                |
 *   |-----------|------------------|-------------------------------------|
 *   | false     | *                | 跳过启动（默认状态）               |
 *   | true      | false (默认)     | spawn 独立 lark-bot 进程（回滚）    |
 *   | true      | true             | 当前 extension 进程即 lark-bot      |
 *
 * 推荐配置：autoStart=true + useExtensionMode=true （PR-1 新路径）。
 * 回滚：autoStart=true + useExtensionMode=false （< 5 分钟切换）。
 *
 * 环境变量 Feature flag：
 *   - LARK_BOT_USE_DUAL_DOMAIN=false：临时关闭域检查（issue#184 引入，回滚诊断用）。
 *     默认 true——所有 feishu_* / larkbot_* 业务工具在临时私聊域调用返回"未鉴权"错误。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { Type } from "typebox";

// 基于扩展文件自身位置推导项目根目录（不依赖 process.cwd()）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..", "..", ".."); // extensions/lark-bot → 项目根

// 飞书 I/O（PR-1：thin wrapper，import 现有 protocol/feishu.ts）
import {
  addReaction,
  delReaction,
  sendReplyGetId,
} from "../../scripts/lark-bot/protocol/feishu.js";
// 群组工具（PR-1：thin wrapper，import 现有 broadcast/group-tool.ts 工厂）
import {
  createGroupTool,
} from "../../scripts/lark-bot/broadcast/group-tool.js";
import { CLI } from "../../scripts/lark-bot/config.js";

// PR-2：鉴权模块（PR-2 起，鉴权决策迁 PI Agent LLM）
import {
  createAuthModule,
} from "../../scripts/lark-bot/business/auth.js";
import type { AuthModule } from "../../scripts/lark-bot/business/auth.js";
import {
  createBroadcastModule,
} from "../../scripts/lark-bot/business/broadcast.js";
import type { BroadcastModule } from "../../scripts/lark-bot/business/broadcast.js";
import {
  createIdentityResolver,
} from "../../scripts/lark-bot/identity-resolver.js";
import type { IdentityResolver } from "../../scripts/lark-bot/identity-resolver.js";
import {
  PROJECT_DIR,
  P2P_AUTH_TIMEOUT_MS,
  P2P_AUTH_MAX_ROUNDS,
  PENDING_EVENTS_MAX_SIZE,
} from "../../scripts/lark-bot/config.js";
// issue#184：双域 slot 管理（独立模块供测试 mock）
import {
  tryReserveTempSlot,
  releaseTempSlot,
  tryReserveBusinessSlot,
  releaseBusinessSlot,
  resetSlots,
} from "../../scripts/lark-bot/business/slots.js";
import { log as sharedLog } from "../../scripts/lark-bot/shared/logger.js";
import { tryReserveAuthorizedSlot, releaseAuthorizedSlot } from "../../scripts/lark-bot/interactive/session-manager.js";
// PR-4：OPERATOR_LOG 模块（任务日志生成 + 校验 + 注册表）
import {
  generateLog,
  formatCommitMessage,
  isOperatorAllowed,
  getOperatorName,
} from "../../../scripts/op-log-schema.js";
import { emitTaskJournal } from "../../scripts/lark-bot/shared/logger.js";

// 子进程注册表（实测 6-3 强制要求）
import { trackChild, killAllChildren } from "./process/children-registry.js";

// ── Module-level 状态（实测 5：原子 Map 操作安全） ───────────────────

/**
 * chatId → 最近一次 spawn 的 PI Agent 子进程。
 *
 * 实测 1+6-1 修正：ctx.chatId 在 PI Agent Extension API 中不存在，
 * lark-bot 必须自行维护 chatId → session 映射，registerTool 接受 chatId 参数从 Map 反查。
 *
 * PR-1 占位：仅持有 ChildProcess 引用（per-chat spawn）。
 * PR-2 扩展：持有完整 SessionManager 句柄（含 NDJSON 事件队列）。
 */
const chatToSession = new Map<string, ChildProcess>();

/**
 * chatId → pendingEvents 队列。
 *
 * PR-1 占位：仅持有 Map，larkbot_fetch_pending_events 暂返回空列表。
 * PR-2 完整实装：
 *   - 飞书事件到达时按 chatId 路由到队列
 *   - LLM 通过 registerTool 拉取（实测 5：原子读+删除）
 */
const pendingEvents = new Map<string, unknown[]>();

/** PR-1：group-tool 工厂实例（依赖注入 CLI 路径） */
const groupTool = createGroupTool({
  cliPath: CLI,
  log: (msg: string) => console.error(`[group-tool] ${msg}`),
});

/**
 * PR-2：extension 自治的鉴权模块。
 *
 * 设计原因：
 *   - 与旧 ingress.ts 的 authModule 单例隔离，避免双重冷启动。
 *   - registerTool 调用时使用本实例的 groups / members Map。
 *   - 回滚路径（main.ts + ingress.ts）的 authModule 不受影响。
 */
const extensionAuthModule: AuthModule = createAuthModule({
  groupTool,
  log: (msg: string) => sharedLog(msg),
});

/**
 * PR-2：extension 自治的工作留痕广播模块。
 */
const extensionBroadcastModule: BroadcastModule = createBroadcastModule({
  groupTool,
  log: (msg: string) => sharedLog(msg),
});

/**
 * PR-2：extension 自治的 identity resolver（open_id → user_id）。
 */
const extensionIdentityResolver: IdentityResolver = createIdentityResolver({
  projectDir: PROJECT_DIR,
  cliPath: CLI,
  log: (msg: string) => sharedLog(msg),
});

/**
 * PR-2：per-chatId 授权状态缓存。
 *
 * registerTool larkbot_authorize_user 内部修改本 Map，PI Agent LLM 通过 registerTool
 * 返回值间接感知鉴权结果。chatId 为 key，值为 {kind, authorized, groupId, groupName, broadcastMessageId}。
 *
 * issue#184：增加 kind 字段标识双域会话分类。
 *   - kind="p2p-temp"：临时私聊域（未鉴权），authorized=false。
 *   - kind="p2p-business"：业务私聊域（已鉴权），authorized=true。
 *   - authorized = (kind === "p2p-business")，保留为冗余字段便于快速判断。
 */
interface ChatAuthState {
  kind: "p2p-temp" | "p2p-business";
  authorized: boolean;
  groupId: string | null;
  groupName: string | null;
  broadcastMessageId: string | null;
}
const chatAuthStates = new Map<string, ChatAuthState>();

// ═══════════════ issue#184：双域会话机制 Module-level 状态 ═══════════════

/**
 * 双域 slot 计数器（tempSlots / businessSlots）已迁至独立模块 business/slots.ts，
 * 便于测试 mock 与未来 main.ts 复用。本文件仅 import 使用，不重新定义。
 */

/** chatId → 域分类（双域会话机制真源）。与 chatAuthStates[chatId].kind 保持同步。 */
const sessionKinds = new Map<string, "p2p-temp" | "p2p-business">();

/** chatId → 鉴权窗口截止时间戳（ms）。进入 temp 域时设置 now + P2P_AUTH_TIMEOUT_MS。 */
const authDeadlines = new Map<string, number>();

/** chatId → larkbot_authorize_user 失败累计次数（no_match / auth_module_error）。超 P2P_AUTH_MAX_ROUNDS → fail-closed。 */
const authRoundsUsed = new Map<string, number>();

/** chatId → 业务私聊域最后活跃时间戳（ms）。用于 P2P_IDLE_TIMEOUT_MS 3 天空闲检测。 */
const businessLastActivityAt = new Map<string, number>();

/**
 * msgId → chatId 反向索引。
 *
 * 用于 registerTool execute 入口从 msgId 反查 chatId 做域检查（决策 2b）。
 * 飞书事件进入 onLarkEvent 时同时写入 pendingEvents 和本 Map。
 */
const pendingEventsByMsgId = new Map<string, string>();

/** 飞书 p2p 事件结构（与 scripts/lark-bot/shared/types.ts LarkEvent 等价，但避免跨模块导入） */
interface ExtLarkEvent {
  type: string;
  chat_id: string;
  chat_type: "p2p";
  sender_id: string;
  message_id: string;
  message_type: string;
  content: string;
  create_time: string;
}

// ═══════════════ Slot 管理 API（issue#184 双域会话机制） ═══════════════

/** 业务私聊域活跃时调用（larkbot_authorize_user matched / 业务消息处理）。防空闲超时。 */
function markBusinessActive(chatId: string): void {
  businessLastActivityAt.set(chatId, Date.now());
}

// ═══════════════ 域检查工具函数（issue#184 双域会话机制） ═══════════════

/**
 * 域检查：仅业务私聊域放行，临时私聊域拒绝。
 *
 * registerTool execute 入口调用——未鉴权时返回"未鉴权"错误，isError: true。
 * PI Agent LLM 看到 isError 后必须先调 larkbot_authorize_user。
 *
 * Feature flag：LARK_BOT_USE_DUAL_DOMAIN=false 时跳过检查（仅供 issue#184 回滚诊断）。
 *
 * @returns null = 放行；error 对象 = 拒绝
 */
function assertBusinessDomain(chatId: string): null | { error: string; status: string } {
  if (process.env.LARK_BOT_USE_DUAL_DOMAIN === "false") return null;
  const kind = sessionKinds.get(chatId);
  if (kind !== "p2p-business") {
    return {
      error: `chatId=${chatId.slice(-12)} 未鉴权（kind=${kind ?? "none"}），请先调 larkbot_authorize_user`,
      status: "not_authorized",
    };
  }
  return null;
}

/** msgId → chatId 反查（用于 feishu_add_reaction / feishu_remove_reaction / feishu_send_reply）。 */
function resolveChatIdByMsgId(msgId: string): string | null {
  return pendingEventsByMsgId.get(msgId) ?? null;
}

// ═══════════════ Session 生命周期辅助函数（issue#184 双域会话机制） ═══════════════

/**
 * 确保临时私聊域 session 存在。
 *
 * 飞书事件进入 onLarkEvent 时调用——新 chatId 占 temp slot + 设置鉴权窗口。
 * 已有 session 仅增加 authRoundsUsed（每条消息触发 larkbot_authorize_user 算一轮）。
 *
 * @returns {ok: true} = 允许进入鉴权；{ok: false, error} = 配额已满需拒绝
 */
function ensureTempSession(chatId: string, msgId: string): { ok: true } | { ok: false; error: string } {
  if (sessionKinds.has(chatId)) {
    // 已有 session：no-op（rounds 由 larkbot_authorize_user 失败路径自行管理）
    return { ok: true };
  }
  // 新 session：检查 temp slot 配额
  if (!tryReserveTempSlot()) {
    return { ok: false, error: "temp slot 配额已满，请稍后再试" };
  }
  sessionKinds.set(chatId, "p2p-temp");
  authDeadlines.set(chatId, Date.now() + P2P_AUTH_TIMEOUT_MS);
  // 初始化 rounds=0（不增加计数）；larkbot_authorize_user 失败路径自行 +1
  authRoundsUsed.set(chatId, 0);
  chatAuthStates.set(chatId, {
    kind: "p2p-temp",
    authorized: false,
    groupId: null,
    groupName: null,
    broadcastMessageId: null,
  });
  return { ok: true };
}

/**
 * 关闭临时私聊域会话（fail-closed 统一入口）。
 *
 * 释放 temp slot + 清理 sessionKinds / authDeadlines / authRoundsUsed / chatAuthStates / taskJournals。
 * 调用场景：
 *   - larkbot_authorize_user matched 时（升级到 business 域后释放 temp slot）
 *   - larkbot_authorize_user not_member 时（fail-closed）
 *   - larkbot_close_temp_session registerTool 调用时
 *   - 60s 周期清理器检测鉴权超时/超轮时
 */
function closeTempSession(chatId: string, reason: string): void {
  releaseTempSlot();
  sessionKinds.delete(chatId);
  authDeadlines.delete(chatId);
  authRoundsUsed.delete(chatId);
  chatAuthStates.delete(chatId);
  taskJournals.delete(chatId); // PR-4 buffer 同步清理
  console.error(`[lark-bot ext] temp session closed: chatId=${chatId.slice(-12)} reason=${reason}`);
}

/**
 * 关闭业务私聊域会话（fail-closed 统一入口）。
 *
 * 释放 business slot + 清理 sessionKinds / businessLastActivityAt。
 * chatAuthStates / taskJournals 由调用方决定是否清理（通常是 larkbot_close_business_session）。
 */
function closeBusinessSession(chatId: string, reason: string): void {
  releaseBusinessSlot();
  sessionKinds.delete(chatId);
  businessLastActivityAt.delete(chatId);
  console.error(`[lark-bot ext] business session closed: chatId=${chatId.slice(-12)} reason=${reason}`);
}

/**
 * PR-4：业务变更累积 buffer。
 *
 * 生命周期（4 阶段）：
 *   - 创建：larkbot_authorize_user matched 分支（PR-4）
 *   - 累积：larkbot_record_change（LLM 每次业务操作后调）
 *   - 提交：larkbot_commit_changes（buffer → LogEntry → commitMessage 返回 LLM）
 *   - 销毁：larkbot_close_business_session 或 session_shutdown
 *
 * 提交后 changes 清空，会话元数据保留（支持一次会话多次 PR 提交）。
 */
interface TaskJournal {
  /** OPERATOR_REGISTRY 校验通过的飞书 user_id */
  operator: string;
  /** OPERATOR_REGISTRY[operator].name */
  operatorName: string | null;
  /** 业务私聊会话开始时刻（ISO 8601） */
  sessionStartedAt: string;
  /** 业务私聊会话关联群组 chat_id */
  groupId: string;
  /** 群组名 */
  groupName: string;
  /** matched broadcast message_id（PR-2 缓存）；close 时用于引用回复 */
  matchedBroadcastMessageId: string | null;
  /** 缓存启动时刻的 promptId */
  promptId: string;
  /** 累积的字段级变更（顺序 = LLM 决策顺序） */
  changes: ChangeEntryLike[];
}

/** PR-4 轻量 ChangeEntry 定义（与 op-log-schema.ts ChangeEntry 等价但避免跨模块导入） */
interface ChangeEntryLike {
  field: string;
  from: unknown;
  to: unknown;
}

const taskJournals = new Map<string, TaskJournal>();

/**
 * PR-4：创建 task_journal buffer（鉴权 matched 时调用）。
 */
function createTaskJournal(input: {
  operator: string;
  operatorName: string | null;
  groupId: string;
  groupName: string;
  matchedBroadcastMessageId: string | null;
  promptId: string;
}): TaskJournal {
  return {
    operator: input.operator,
    operatorName: input.operatorName,
    sessionStartedAt: new Date().toISOString(),
    groupId: input.groupId,
    groupName: input.groupName,
    matchedBroadcastMessageId: input.matchedBroadcastMessageId,
    promptId: input.promptId,
    changes: [],
  };
}

/**
 * PR-4：buffer → LogEntry 转换（larkbot_commit_changes 内部调用）。
 * N4 §6.4 明确为独立函数，便于单元测试。
 */
function taskJournalToLogEntry(journal: TaskJournal): { operator: string; timestamp: string; changes: ChangeEntryLike[] } {
  return generateLog(journal.operator, journal.changes as any);
}

// ═══════════════ Extension 主入口 ═══════════════

export default function (pi: any) {
  // ── 启动期（PR-1：保留 autoStart + 新增 useExtensionMode 分支） ──
  pi.on("session_start", async (event: any) => {
    if (event.reason !== "startup") return;

    // PR-2 / issue#184 修复：initBoot 在 LARK_BOT_RUNTIME 检查之前跑。
    // 关键：pi 子进程（设 LARK_BOT_RUNTIME=1）会加载本 extension 并注册 registerTool，
    // 这些 registerTool 引用 extensionAuthModule（独立于 main.ts authModule 的实例）。
    // 若不在 LARK_BOT_RUNTIME 检查之前调 initBoot，pi 子进程的 extensionAuthModule.groups 为空，
    // registerTool larkbot_authorize_user 永远返回 no_match。
    // 回归来源：issue#184 PR #185 引入双域会话机制但未迁移 initBoot 调用位置。
    try {
      await extensionAuthModule.initBoot();
    } catch (err: any) {
      console.error(`[lark-bot ext] auth 冷启动失败: ${err?.message?.slice(0, 200)}`);
      throw err;
    }

    // 防递归：被 PI Agent spawn 的子进程不再走扩展路径（不启动子进程 / 事件订阅）
    // 但 initBoot 已跑（registerTool 用的 extensionAuthModule.groups 已有数据）。
    if (process.env.LARK_BOT_RUNTIME === "1") return;

    const settings = readSettings();
    const useExtensionMode = settings?.larkBot?.useExtensionMode === true;
    const autoStart = settings?.larkBot?.autoStart === true;

    // ── 分支 1：useExtensionMode=false（默认）── 启动旧 lark-bot 进程作为回滚
    if (!useExtensionMode) {
      if (!autoStart) {
        console.error("[lark-bot ext] useExtensionMode=false + autoStart=false，跳过启动。");
        return;
      }
      // 旧逻辑：spawn 独立 lark-bot 进程（保留 PR-1 之前代码路径）
      await startLegacyLarkBotProcess();
      return;
    }

    // ── 分支 2：useExtensionMode=true ── 当前进程即 lark-bot（PR-1 新增）
    console.error("[lark-bot ext] useExtensionMode=true，lark-bot 即当前 extension 进程");

    // 启动 lark-cli event consume 子进程（实测 3：同时监听 stderr + stdout）
    const larkCli = spawnLarkCliEventConsume();
    trackChild(larkCli); // 实测 6-3

    console.error("[lark-bot ext] 启动完成，registerTool 已注册（7+4 个）");
  });

  // ── 关闭期（实测 6-3：手动遍历 children kill） ──
  pi.on("session_shutdown", async (event: any) => {
    console.error(`[lark-bot ext] session_shutdown reason=${event.reason}`);

    // 手动 kill 所有 tracked children（实测 6-3 强制要求）
    const killed = killAllChildren();
    if (killed > 0) {
      console.error(`[lark-bot ext] 已 kill ${killed} 个 tracked 子进程`);
    }

    // 清空 module-level 状态
    chatToSession.clear();
    pendingEvents.clear();
    chatAuthStates.clear();
    taskJournals.clear(); // PR-4
    extensionIdentityResolver.clearCache();
    // issue#184：清空双域会话机制状态
    sessionKinds.clear();
    authDeadlines.clear();
    authRoundsUsed.clear();
    businessLastActivityAt.clear();
    pendingEventsByMsgId.clear();
    resetSlots(); // issue#184：重置 slots 模块计数器
    console.error(`[lark-bot ext] issue#184 双域状态已清空`);
  });

  // ═══════════════ registerTool 注册（PR-1: 8 个） ═══════════════

  // ── 1. feishu_add_reaction ──
  pi.registerTool({
    name: "feishu_add_reaction",
    label: "添加飞书消息表情",
    description:
      "为指定飞书消息添加 emoji 表情反应。返回 reaction_id 用于后续切换或删除。" +
      "常用 emoji: WAVE / THINKING / DONE / ERROR。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。须先调 larkbot_authorize_user。" +
      "（PR-1: registerTool 替代 protocol/feishu.ts addReaction）",
    parameters: Type.Object({
      msgId: Type.String({ description: "飞书消息 ID" }),
      emoji: Type.String({ description: "emoji 类型，如 'WAVE'" }),
    }),
    execute: async (_toolCallId: string, params: { msgId: string; emoji: string }) => {
      // issue#184：域检查（msgId → chatId → 业务私聊域）
      const chatId = resolveChatIdByMsgId(params.msgId);
      if (!chatId) {
        return {
          content: [{ type: "text", text: `❌ msgId 不在待处理队列（可能已被清理）` }],
          details: { ok: false, error: "msgId not found" },
          isError: true,
        };
      }
      const deny = assertBusinessDomain(chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const reactionId = addReaction(params.msgId, params.emoji);
      if (reactionId === null) {
        return {
          content: [{ type: "text", text: `❌ 添加表情失败（熔断器开启或 lark-cli 错误）` }],
          details: { ok: false, reactionId: null },
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `✅ 已添加表情 ${params.emoji}（reaction_id=${reactionId.slice(0, 12)}...）` }],
        details: { ok: true, reactionId },
      };
    },
  });

  // ── 2. feishu_remove_reaction ──
  pi.registerTool({
    name: "feishu_remove_reaction",
    label: "删除飞书消息表情",
    description:
      "通过 reaction_id 删除已添加的飞书消息表情。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。" +
      "（PR-1: registerTool 替代 protocol/feishu.ts delReaction）",
    parameters: Type.Object({
      msgId: Type.String({ description: "飞书消息 ID" }),
      reactionId: Type.String({ description: "reaction_id（feishu_add_reaction 返回）" }),
    }),
    execute: async (_toolCallId: string, params: { msgId: string; reactionId: string }) => {
      const chatId = resolveChatIdByMsgId(params.msgId);
      if (!chatId) {
        return {
          content: [{ type: "text", text: `❌ msgId 不在待处理队列` }],
          details: { ok: false, error: "msgId not found" },
          isError: true,
        };
      }
      const deny = assertBusinessDomain(chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      // delReaction 是 best-effort，不抛错
      delReaction(params.msgId, params.reactionId);
      return {
        content: [{ type: "text", text: `✅ 已删除表情` }],
        details: { ok: true },
      };
    },
  });

  // ── 3. feishu_send_reply ──
  pi.registerTool({
    name: "feishu_send_reply",
    label: "回复飞书消息",
    description:
      "回复飞书私聊消息。返回新消息 message_id。" +
      "超时 18s（超时返回 timedOut: true）。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。须先调 larkbot_authorize_user。" +
      "（PR-1: registerTool 替代 protocol/feishu.ts sendReplyGetId）",
    parameters: Type.Object({
      msgId: Type.String({ description: "飞书消息 ID" }),
      text: Type.String({ description: "回复内容", maxLength: 4000 }),
    }),
    execute: async (_toolCallId: string, params: { msgId: string; text: string }) => {
      const chatId = resolveChatIdByMsgId(params.msgId);
      if (!chatId) {
        return {
          content: [{ type: "text", text: `❌ msgId 不在待处理队列` }],
          details: { ok: false, error: "msgId not found" },
          isError: true,
        };
      }
      const deny = assertBusinessDomain(chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const result = await sendReplyGetId(params.msgId, params.text);
      if (result.ok && result.replyId) {
        return {
          content: [{ type: "text", text: `✅ 已回复（message_id=${result.replyId.slice(0, 12)}...）` }],
          details: { ok: true, replyId: result.replyId },
        };
      }
      return {
        content: [{ type: "text", text: `❌ 回复失败：${result.error ?? "unknown"}` }],
        details: { ok: false, error: result.error, timedOut: result.timedOut ?? false },
        isError: true,
      };
    },
  });

  // ── 4. feishu_get_group_info ──
  pi.registerTool({
    name: "feishu_get_group_info",
    label: "获取飞书群组信息",
    description:
      "获取指定 chatId 的飞书群组信息（名称、描述、成员数等）。失败返回 null。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。" +
      "（PR-1: registerTool 替代 broadcast/group-tool.ts getGroupInfo）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书群组 chat_id" }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string }) => {
      const deny = assertBusinessDomain(params.chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const info = await groupTool.getGroupInfo(params.chatId);
      if (info === null) {
        return {
          content: [{ type: "text", text: `❌ 获取群组信息失败：chat_id 非法或 lark-cli 错误` }],
          details: { ok: false, info: null },
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `✅ 群组：${info.name}（${info.chatId}）\n描述：${info.description}` }],
        details: { ok: true, info },
      };
    },
  });

  // ── 5. feishu_list_group_members ──
  pi.registerTool({
    name: "feishu_list_group_members",
    label: "列出飞书群组成员",
    description:
      "返回指定 chatId 的群组成员 open_id 列表。失败返回 null。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。" +
      "（PR-1: registerTool 替代 broadcast/group-tool.ts listGroupMembers）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书群组 chat_id" }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string }) => {
      const deny = assertBusinessDomain(params.chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const members = await groupTool.listGroupMembers(params.chatId);
      if (members === null) {
        return {
          content: [{ type: "text", text: `❌ 列出群成员失败：chat_id 非法或 lark-cli 错误` }],
          details: { ok: false, members: null },
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `✅ 群成员数：${members.length}` }],
        details: { ok: true, members },
      };
    },
  });

  // ── 6. feishu_send_group_message ──
  pi.registerTool({
    name: "feishu_send_group_message",
    label: "发送飞书群组消息",
    description:
      "向指定 chatId 群组发送消息（可选 @用户 / 回复原消息）。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。" +
      "（PR-1: registerTool 替代 broadcast/group-tool.ts sendGroupMessage）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书群组 chat_id" }),
      text: Type.String({ description: "消息内容", maxLength: 4000 }),
      mention: Type.Optional(Type.String({ description: "@用户 open_id（可选）" })),
      replyTo: Type.Optional(Type.String({ description: "回复消息 message_id（可选）" })),
    }),
    execute: async (_toolCallId: string, params: { chatId: string; text: string; mention?: string; replyTo?: string }) => {
      const deny = assertBusinessDomain(params.chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const result = await groupTool.sendGroupMessage(params.chatId, {
        text: params.text,
        mentionOpenId: params.mention,
        replyToMessageId: params.replyTo,
      });
      if (result.ok && result.messageId) {
        return {
          content: [{ type: "text", text: `✅ 已发送群组消息（message_id=${result.messageId.slice(0, 12)}...）` }],
          details: { ok: true, messageId: result.messageId },
        };
      }
      return {
        content: [{ type: "text", text: `❌ 发送群组消息失败：${result.error ?? "unknown"}` }],
        details: { ok: false, error: result.error },
        isError: true,
      };
    },
  });

  // ── 7. feishu_list_bot_groups ──
  pi.registerTool({
    name: "feishu_list_bot_groups",
    label: "列出 Bot 所在的所有群组",
    description:
      "返回 Bot 所在的所有飞书群组列表（含 chatId / name / description）。" +
      "鉴权判定（PR-2）的候选群组数据源。**issue#184 双域会话机制**：不限域（鉴权辅助工具）。" +
      "（PR-1: registerTool 替代 broadcast/group-tool.ts listAllBotGroups）",
    parameters: Type.Object({}),
    execute: async (_toolCallId: string, _params: {}) => {
      const groups = await groupTool.listAllBotGroups();
      if (groups === null) {
        return {
          content: [{ type: "text", text: `❌ 列出群组失败：lark-cli 错误` }],
          details: { ok: false, groups: null },
          isError: true,
        };
      }
      const summary = groups.map((g) => `- ${g.name} (${g.chatId})`).join("\n");
      return {
        content: [{ type: "text", text: `✅ 共 ${groups.length} 个群组：\n${summary}` }],
        details: { ok: true, groups },
      };
    },
  });

  // ═══════════════ PR-2：鉴权 registerTool ═══════════════
  // 业务描述 → chatId 决策由 PI Agent LLM 完成，lark-bot 仅做成员资格校验。
  // 参考 N4 §4.5 registerTool 契约 + 实测 1-6 修正。

  // ── 8. larkbot_list_candidate_groups ──
  pi.registerTool({
    name: "larkbot_list_candidate_groups",
    label: "列出候选鉴权群组",
    description:
      "返回 Bot 所在的有 description 的群组列表（含 chatId/name/description）。" +
      "鉴权判定（PR-2）的候选群组数据源。LLM 拿到 candidates 后根据用户业务描述决策 chatId。" +
      "决策后调用 larkbot_authorize_user 验证成员资格。" +
      "（PR-2: registerTool 替代 business/auth.ts candidates 过滤逻辑）",
    parameters: Type.Object({}),
    execute: async (_toolCallId: string, _params: {}) => {
      // 委托给 authModule.getCandidates（扩展内部接口）
      // PR-2：auth.ts authorize 不再返回 candidates；这里直接调 groupTool.listAllBotGroups
      // 复用冷启动的 groups Map（groupCount() 验证）
      const allGroups = await groupTool.listAllBotGroups();
      if (allGroups === null) {
        return {
          content: [{ type: "text", text: `❌ 列出群组失败：lark-cli 错误` }],
          details: { ok: false, candidates: null },
          isError: true,
        };
      }
      const candidates = allGroups.filter((g) => g.description?.trim());
      const summary = candidates.map((g) => `- ${g.name} (${g.chatId}): ${g.description.slice(0, 80)}`).join("\n");
      return {
        content: [{ type: "text", text: `✅ 共 ${candidates.length} 个候选群组：\n${summary}` }],
        details: { ok: true, candidates },
      };
    },
  });

  // ── 9. larkbot_authorize_user ──
  pi.registerTool({
    name: "larkbot_authorize_user",
    label: "授权用户业务私聊",
    description:
      "校验用户是否在指定群组成员列表中。LLM 决策 chatId 后调用。返回 matched / not_member / no_match / auth_module_error。" +
      "matched 时自动 slot swap（释放 temp slot → 占用 business slot）+ 广播到群组 + 缓存 chatAuthStates + 升级 kind=p2p-business。" +
      "not_member 时 fail-closed（closeTempSession）。" +
      "**issue#184 双域会话机制**：不限域（鉴权工具本身必须可在临时私聊域调用）。" +
      "**新增参数 msgId**：用于反查 chatId 一致性校验（防 LLM 错传）。" +
      "（PR-2: registerTool 替代 business/auth.ts authorize / substringMatch）",
    parameters: Type.Object({
      openId: Type.String({ description: "飞书用户 open_id" }),
      chatId: Type.String({ description: "LLM 决策的群组 chat_id" }),
      msgId: Type.Optional(Type.String({ description: "当前处理的飞书消息 msgId（issue#184 新增；用于反查 chatId 一致性）" })),
    }),
    execute: async (_toolCallId: string, params: { openId: string; chatId: string; msgId?: string }) => {
      // issue#184：msgId → chatId 一致性校验（防御 LLM 错传）
      if (params.msgId) {
        const expectedChatId = resolveChatIdByMsgId(params.msgId);
        if (expectedChatId && expectedChatId !== params.chatId) {
          return {
            content: [{ type: "text", text: `❌ msgId 反查 chatId=${expectedChatId.slice(-12)} 与传入 chatId=${params.chatId.slice(-12)} 不一致` }],
            details: { status: "auth_module_error", reason: "msgId_chatId_mismatch" },
            isError: true,
          };
        }
      }

      // issue#184：防御性 ensureTempSession（允许 LLM 在 onLarkEvent 之前调用 authorize_user）
      // 生产路径：onLarkEvent 优先调 ensureTempSession → 这里 no-op。
      // 测试路径：直接调 authorize_user 时这里占 temp slot。
      if (!sessionKinds.has(params.chatId)) {
        const ensure = ensureTempSession(params.chatId, params.msgId ?? "");
        if (!ensure.ok) {
          return {
            content: [{ type: "text", text: `❌ ${ensure.error}` }],
            details: { status: "auth_module_error", reason: "temp_quota_full" },
            isError: true,
          };
        }
      }

      // issue#184：鉴权窗口/轮次预检查（fail-fast）
      // 注意：rounds 在 ensureTempSession 后取值。预检查采用 >= 边界：
      //   rounds = P2P_AUTH_MAX_ROUNDS 表示已失败 MAX 次，下次调用必须 fail-closed
      const rounds = authRoundsUsed.get(params.chatId) ?? 0;
      if (rounds >= P2P_AUTH_MAX_ROUNDS) {
        closeTempSession(params.chatId, "auth_rounds_exceeded");
        return {
          content: [{ type: "text", text: `❌ 鉴权轮次超限（${rounds} >= ${P2P_AUTH_MAX_ROUNDS}），session 已关闭` }],
          details: { status: "auth_module_error", reason: "auth_rounds_exceeded", closed: true },
          isError: true,
        };
      }
      const deadline = authDeadlines.get(params.chatId);
      if (deadline && Date.now() > deadline) {
        closeTempSession(params.chatId, "auth_timeout");
        return {
          content: [{ type: "text", text: `❌ 鉴权窗口超时（>${P2P_AUTH_TIMEOUT_MS}ms），session 已关闭` }],
          details: { status: "auth_module_error", reason: "auth_timeout", closed: true },
          isError: true,
        };
      }

      const authResult = await extensionAuthModule.authorize({
        openId: params.openId,
        chatId: params.chatId,
      });

      // matched 时执行 slot swap（issue#184 核心机制）
      if (authResult.status === "matched") {
        // ★ Slot swap：释放 temp slot → 占用 business slot
        releaseTempSlot();
        if (!tryReserveBusinessSlot()) {
          // 业务配额满 → 失败回滚（重新占 temp slot 保持状态）
          tryReserveTempSlot();
          console.error(`[lark-bot ext] larkbot_authorize_user: 业务私聊配额已满 chatId=${params.chatId.slice(-12)}`);
          return {
            content: [{ type: "text", text: `❌ 鉴权通过但业务私聊配额已满` }],
            details: { status: "auth_module_error", reason: "business_quota_full" },
            isError: true,
          };
        }
        markBusinessActive(params.chatId);

        const broadcast = await extensionBroadcastModule.announce({
          openId: params.openId,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          outcome: "matched",
        });

        // ★ 同步更新两个状态真源
        sessionKinds.set(params.chatId, "p2p-business");
        chatAuthStates.set(params.chatId, {
          kind: "p2p-business",
          authorized: true,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          broadcastMessageId: broadcast.ok ? (broadcast.messageId ?? null) : null,
        });

        // PR-4：解析 operator + 创建 task_journal buffer
        const operatorCtx = await extensionIdentityResolver.resolveOperator(params.openId);
        if (!operatorCtx) {
          // fail-closed：未在 OPERATOR_REGISTRY，回滚所有状态
          releaseBusinessSlot();
          sessionKinds.delete(params.chatId);
          chatAuthStates.delete(params.chatId);
          businessLastActivityAt.delete(params.chatId);
          tryReserveTempSlot(); // 回到 temp 域
          sessionKinds.set(params.chatId, "p2p-temp");
          console.error(`[lark-bot ext] larkbot_authorize_user matched 但 operator 未注册 openId=${params.openId.slice(-12)}`);
          return {
            content: [{ type: "text", text: `❌ operator 未在 OPERATOR_REGISTRY 中` }],
            details: { status: "auth_module_error", reason: "operator_not_in_registry" },
            isError: true,
          };
        }
        // 双保险
        if (!isOperatorAllowed(operatorCtx.operator)) {
          releaseBusinessSlot();
          sessionKinds.delete(params.chatId);
          chatAuthStates.delete(params.chatId);
          businessLastActivityAt.delete(params.chatId);
          tryReserveTempSlot();
          sessionKinds.set(params.chatId, "p2p-temp");
          return {
            content: [{ type: "text", text: `❌ operator ${operatorCtx.operator} 未在 OPERATOR_REGISTRY 中` }],
            details: { status: "auth_module_error", reason: "operator_not_in_registry" },
            isError: true,
          };
        }
        const taskJournal = createTaskJournal({
          operator: operatorCtx.operator,
          operatorName: operatorCtx.name,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          matchedBroadcastMessageId: broadcast.messageId ?? null,
          promptId: `auth-${Date.now()}`,
        });
        taskJournals.set(params.chatId, taskJournal);
        console.error(`[lark-bot ext] issue#184 slot swap: chatId=${params.chatId.slice(-12)} temp→business, operator=${operatorCtx.operator}`);

        // ★ 清理鉴权窗口状态（已升级到 business 域，不再需要）
        authDeadlines.delete(params.chatId);
        authRoundsUsed.delete(params.chatId);

        // 释放旧路径的 tryReserveAuthorizedSlot（与新 slot swap 二选一）
        tryReserveAuthorizedSlot(); // 兼容旧 PiSession.authorized 计数

        return {
          content: [{ type: "text", text: `✅ 鉴权通过：group=${authResult.groupName} (${authResult.groupId})${broadcast.ok && broadcast.messageId ? ` broadcast=${broadcast.messageId.slice(-12)}...` : ""}` }],
          details: {
            status: "matched",
            kind: "p2p-business",
            groupId: authResult.groupId,
            groupName: authResult.groupName,
            broadcastMessageId: broadcast.messageId ?? null,
          },
        };
      }

      // not_member 时广播到群组 + fail-closed（issue#184 修复：原实现仅广播不关闭）
      if (authResult.status === "not_member") {
        await extensionBroadcastModule.announce({
          openId: params.openId,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          outcome: "not_member",
        });
        closeTempSession(params.chatId, "not_member");
        return {
          content: [{ type: "text", text: `❌ 你不在授权群组 "${authResult.groupName}" 中，session 已关闭` }],
          details: { status: "not_member", groupId: authResult.groupId, groupName: authResult.groupName, closed: true },
          isError: true,
        };
      }

      // no_match / auth_module_error：不立即关闭（保留重试）+ 增加鉴权轮次
      authRoundsUsed.set(params.chatId, rounds + 1);
      const errMsg =
        authResult.status === "no_match"
          ? `⚠ 未找到匹配的业务群组（chatId=${params.chatId.slice(-12)}）`
          : `❌ 鉴权模块异常：${authResult.reason}`;
      return {
        content: [{ type: "text", text: errMsg }],
        details: { ...authResult, roundsUsed: rounds + 1, roundsMax: P2P_AUTH_MAX_ROUNDS },
        isError: authResult.status === "auth_module_error",
      };
    },
  });

  // ── 10. larkbot_resolve_operator ──
  pi.registerTool({
    name: "larkbot_resolve_operator",
    label: "解析飞书 user_id",
    description:
      "把飞书 open_id 解析为稳定 user_id。LRU 缓存（成功 TTL 1h，失败 30s）。" +
      "校验 user_id 是否在 OPERATOR_REGISTRY。PR-4 task_journal buffer 初始化时调用。" +
      "（PR-2: registerTool 包装 identity-resolver.ts resolveOperator）",
    parameters: Type.Object({
      openId: Type.String({ description: "飞书 open_id" }),
    }),
    execute: async (_toolCallId: string, params: { openId: string }) => {
      const ctx = await extensionIdentityResolver.resolveOperator(params.openId);
      if (ctx === null) {
        return {
          content: [{ type: "text", text: `❌ 解析失败：open_id=${params.openId.slice(-12)} 不在 OPERATOR_REGISTRY 或 lark-cli 错误` }],
          details: { ok: false, operator: null },
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `✅ 解析成功：${ctx.operator} (${ctx.name ?? "未知"})` }],
        details: { ok: true, operator: ctx.operator, name: ctx.name },
      };
    },
  });

  // ── 11. larkbot_get_chat_auth_state（PR-2 辅助工具）──
  pi.registerTool({
    name: "larkbot_get_chat_auth_state",
    label: "查询 chat 鉴权状态",
    description:
      "查询指定 chatId 的鉴权状态（authorized / groupId / groupName / broadcastMessageId）。" +
      "PR-2 辅助工具：LLM 在处理业务消息时可调用，确认当前 chat 是否已鉴权。" +
      "（chatId 来源：飞书事件。PR-2 起 chatId 由调用方传入。）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书 chat_id" }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string }) => {
      const state = chatAuthStates.get(params.chatId);
      if (!state) {
        return {
          content: [{ type: "text", text: `⚠️ chatId=${params.chatId.slice(-12)} 未鉴权` }],
          details: { authorized: false, groupId: null, groupName: null, broadcastMessageId: null },
        };
      }
      return {
        content: [{ type: "text", text: `✅ chatId=${params.chatId.slice(-12)} 已鉴权：${state.groupName}` }],
        details: state,
      };
    },
  });

  // ═══════════════ PR-4：任务日志 registerTool ═══════════════

  // ── 12. larkbot_record_change ──
  pi.registerTool({
    name: "larkbot_record_change",
    label: "记录业务变更",
    description:
      "把字段级变更累积到当前 chat 的 task_journal buffer。" +
      "LLM 在每次业务操作后调用。buffer 会在 larkbot_commit_changes 后清空。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。" +
      "（PR-4: registerTool 替代 task-state-machine.ts 手动累积）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书 chat_id（PR-4 起需传）" }),
      field: Type.String({ description: "JSONPath-like 字段路径，如 'teams[0].bossHP'" }),
      from: Type.Optional(Type.Unknown({ description: "操作前值（undefined 表示新增）" })),
      to: Type.Optional(Type.Unknown({ description: "操作后值（undefined 表示删除）" })),
    }),
    execute: async (_toolCallId: string, params: { chatId: string; field: string; from?: unknown; to?: unknown }) => {
      // issue#184：域检查（业务工具）
      const deny = assertBusinessDomain(params.chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const journal = taskJournals.get(params.chatId);
      if (!journal) {
        return {
          content: [{ type: "text", text: `❌ chatId=${params.chatId.slice(-12)} 会话不存在` }],
          details: { ok: false, error: "no_journal" },
          isError: true,
        };
      }
      journal.changes.push({ field: params.field, from: params.from, to: params.to });
      markBusinessActive(params.chatId);
      return {
        content: [{ type: "text", text: `✅ 已记录变更：${params.field}（buffer 大小：${journal.changes.length}）` }],
        details: { ok: true, journalSize: journal.changes.length },
      };
    },
  });

  // ── 13. larkbot_commit_changes ──
  pi.registerTool({
    name: "larkbot_commit_changes",
    label: "提交业务变更（生成 commit message）",
    description:
      "把 task_journal buffer 转换为 LogEntry，生成 commit message 返回给 LLM。" +
      "LLM 拿到 commitMessage 后必须调用 content-pr skill 完成 git 操作。" +
      "**commitMessage 必须 100% 原样使用，不得修改任何字符**（content-pr skill 负责 git 操作；" +
      "LLM 不构造或修改 commit message）。" +
      "提交成功后 buffer.changes 清空，会话元数据保留（支持多次 PR）。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。" +
      "（PR-4: registerTool 替代 task_journal → LogEntry → commit message 手工拼接）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书 chat_id" }),
      shortDesc: Type.String({ description: "commit message 第一行简短描述", maxLength: 100 }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string; shortDesc: string }) => {
      // issue#184：域检查
      const deny = assertBusinessDomain(params.chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const journal = taskJournals.get(params.chatId);
      if (!journal || journal.changes.length === 0) {
        return {
          content: [{ type: "text", text: `❌ buffer 为空或不存在：chatId=${params.chatId.slice(-12)}` }],
          details: { ok: false, error: "no_changes" },
          isError: true,
        };
      }
      // 防御性二次校验（避免 buffer 创建后 OPERATOR_REGISTRY 变化）
      if (!isOperatorAllowed(journal.operator)) {
        return {
          content: [{ type: "text", text: `❌ operator ${journal.operator} 未在 OPERATOR_REGISTRY 中` }],
          details: { ok: false, error: "operator_not_in_registry" },
          isError: true,
        };
      }
      const logEntry = taskJournalToLogEntry(journal);
      const commitMessage = formatCommitMessage(params.shortDesc, logEntry as any);
      const changesCount = journal.changes.length;
      journal.changes = []; // 清空（保留会话元数据）
      markBusinessActive(params.chatId);
      // 写 audit journal
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: journal.promptId,
        operator: journal.operator,
        operatorName: journal.operatorName,
        state: "awaiting_review",
        reason: `shortDesc=${params.shortDesc} changesCount=${changesCount}`,
      });
      return {
        content: [{ type: "text", text: `✅ 已生成 commit message（changes=${changesCount}）。请用 content-pr skill 提交 PR。` }],
        details: {
          ok: true,
          logEntry,
          commitMessage,
          journalReset: true,
        },
      };
    },
  });

  // ── 14. larkbot_close_business_session ──
  pi.registerTool({
    name: "larkbot_close_business_session",
    label: "关闭业务私聊会话",
    description:
      "关闭当前业务私聊会话，清理 journal buffer，触发 ended 广播（引用回复 matched 消息）。" +
      "不提交 PR——如需提交 PR 必须先调 larkbot_commit_changes。" +
      "不强制 changes 非空（关闭会话与提交 PR 是两个独立事件）。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误 + closeBusinessSession 释放 business slot。" +
      "（PR-4: registerTool 替代 cleanupSessionForClose 手工调用 + broadcast ended 联动）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书 chat_id" }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string }) => {
      // issue#184：域检查
      const deny = assertBusinessDomain(params.chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const authState = chatAuthStates.get(params.chatId);
      const journal = taskJournals.get(params.chatId);
      if (!authState || !authState.authorized) {
        return {
          content: [{ type: "text", text: `❌ chatId=${params.chatId.slice(-12)} 会话不存在` }],
          details: { ok: false, error: "not_authorized" },
          isError: true,
        };
      }
      // 触发 ended 广播
      let broadcastMessageId: string | null = null;
      if (authState.broadcastMessageId) {
        const broadcast = await extensionBroadcastModule.announce({
          openId: params.openId ?? "",
          groupId: authState.groupId,
          groupName: authState.groupName ?? "",
          outcome: "ended",
          replyToMessageId: authState.broadcastMessageId,
        });
        if (broadcast.ok && broadcast.messageId) {
          broadcastMessageId = broadcast.messageId;
        }
      }
      // issue#184：释放 business slot（slot swap 释放）
      closeBusinessSession(params.chatId, "user_close_business_session");
      // 写 audit journal
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: journal?.promptId ?? "n/a",
        operator: journal?.operator ?? "unknown",
        operatorName: journal?.operatorName ?? null,
        state: "terminated",
        reason: journal && journal.changes.length > 0 ? "session_closed_with_pending_changes" : "session_closed",
      });
      // 清理 buffer 与 state
      taskJournals.delete(params.chatId);
      chatAuthStates.delete(params.chatId);
      return {
        content: [{ type: "text", text: `✅ 业务私聊会话已关闭${broadcastMessageId ? `（ended 广播已发）` : ""}` }],
        details: { ok: true, status: "closed", broadcastMessageId },
      };
    },
  });

  // ── 15. larkbot_query_journal（调试用）──
  pi.registerTool({
    name: "larkbot_query_journal",
    label: "查询当前 task_journal",
    description:
      "查询指定 chatId 的 task_journal buffer 状态。调试用，不参与业务流程。" +
      "**issue#184 双域会话机制**：临时私聊域调用返回“未鉴权”错误。" +
      "（PR-4: registerTool 替代 task_journal buffer 手动查询）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书 chat_id" }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string }) => {
      // issue#184：域检查
      const deny = assertBusinessDomain(params.chatId);
      if (deny) {
        return {
          content: [{ type: "text", text: `❌ ${deny.error}` }],
          details: { ok: false, status: deny.status },
          isError: true,
        };
      }
      const journal = taskJournals.get(params.chatId);
      if (!journal) {
        return {
          content: [{ type: "text", text: `⚠️ chatId=${params.chatId.slice(-12)} 无 task_journal buffer` }],
          details: { empty: true },
        };
      }
      return {
        content: [{ type: "text", text: `✅ task_journal: operator=${journal.operator} changes=${journal.changes.length}` }],
        details: {
          operator: journal.operator,
          operatorName: journal.operatorName,
          sessionStartedAt: journal.sessionStartedAt,
          groupId: journal.groupId,
          changesCount: journal.changes.length,
          changes: journal.changes,
        },
      };
    },
  });

  // ═══════════════ issue#184 新增：larkbot_close_temp_session ═══════════════

  // ── 16. larkbot_close_temp_session（issue#184 新增）──
  pi.registerTool({
    name: "larkbot_close_temp_session",
    label: "关闭临时私聊会话（鉴权失败清理）",
    description:
      "关闭临时私聊域会话，释放 temp slot，清理 chatAuthStates/taskJournals。" +
      "PI Agent 在鉴权失败（no_match/not_member/auth_module_error）后调用。" +
      "60s 周期清理器也会自动调用（鉴权超时/超轮时）。" +
      "仅在 kind 为 p2p-temp 时操作；其他 kind 视为已关闭（幂等返回）。" +
      "（issue#184: 鉴权失败 fail-closed）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书 chat_id" }),
      reason: Type.String({
        description: "关闭原因：no_match / not_member / auth_module_error / user_requested / auth_timeout / auth_rounds_exceeded",
      }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string; reason: string }) => {
      const kind = sessionKinds.get(params.chatId);
      if (kind !== "p2p-temp") {
        return {
          content: [{ type: "text", text: `⚠️ chatId=${params.chatId.slice(-12)} 不在临时私聊域（kind=${kind ?? "none"}），幂等跳过` }],
          details: { ok: true, alreadyClosed: true, kind: kind ?? null },
        };
      }
      closeTempSession(params.chatId, params.reason);
      return {
        content: [{ type: "text", text: `✅ 临时私聊已关闭：${params.reason}` }],
        details: { ok: true, reason: params.reason },
      };
    },
  });
}

// ═══════════════ 辅助函数 ═══════════════

/**
 * issue#184：60s 周期清理器
 *
 * 检查三类状态：
 *   1. 鉴权窗口超时：authDeadlines 超 P2P_AUTH_TIMEOUT_MS → fail-closed（closeTempSession）
 *   2. 鉴权轮次超限：authRoundsUsed > P2P_AUTH_MAX_ROUNDS → fail-closed（closeTempSession）
 *   3. 业务私聊空闲超时：businessLastActivityAt 超 P2P_IDLE_TIMEOUT_MS → 仅记录（不主动关闭，
 *      业务私聊关闭仍由 PI Agent 主动调 larkbot_close_business_session；3 天宽限作为观测期）
 *
 * 内存保护：pendingEventsByMsgId 超 PENDING_EVENTS_MAX_SIZE 自动清空（onLarkEvent 内已实现）。
 *
 * 设计依据：lark-bot-p2p-business-design.md §7 60s 周期清理器扩展。
 */
setInterval(() => {
  const now = Date.now();
  // 1. 鉴权窗口超时清理
  for (const [chatId, deadline] of authDeadlines) {
    if (now > deadline) {
      console.error(`[lark-bot ext] auth_timeout fail-closed: chatId=${chatId.slice(-12)}`);
      closeTempSession(chatId, "auth_timeout");
    }
  }
  // 2. 鉴权轮次超限清理
  for (const [chatId, rounds] of authRoundsUsed) {
    if (rounds > P2P_AUTH_MAX_ROUNDS) {
      console.error(`[lark-bot ext] auth_rounds_exceeded fail-closed: chatId=${chatId.slice(-12)} rounds=${rounds}`);
      closeTempSession(chatId, "auth_rounds_exceeded");
    }
  }
  // 3. 业务私聊空闲超时仅记录（不主动关闭，避免误杀长时间未发消息的业务会话）
  // for (const [chatId, lastActivity] of businessLastActivityAt) {
  //   if (now - lastActivity > P2P_IDLE_TIMEOUT_MS) {
  //     console.error(`[lark-bot ext] business_idle_timeout observation: chatId=${chatId.slice(-12)} idleMs=${now - lastActivity}`);
  //   }
  // }
}, 60_000);

/**
 * issue#184：测试专用 helper——清空所有 module-level state。
 *
 * 生产环境不调用此函数——session_shutdown handler 自行清理所有 state。
 * 供 vitest beforeEach 调用以隔离测试间状态。
 */
export function __resetDualDomainForTest(): void {
  sessionKinds.clear();
  authDeadlines.clear();
  authRoundsUsed.clear();
  businessLastActivityAt.clear();
  pendingEventsByMsgId.clear();
  chatAuthStates.clear();
  resetSlots();
}

/**
 * issue#184：测试专用 helper——模拟 onLarkEvent 注入 msgId → chatId 路由。
 *
 * 模拟飞书事件到达后的状态，绕过 lark-cli 子进程 mock 复杂度。
 * 供测试 registerTool execute 入口域检查使用。
 */
export function __injectPendingEventForTest(msgId: string, chatId: string): void {
  pendingEventsByMsgId.set(msgId, chatId);
}

/**
 * 读取 settings.json（本地凭证文件，不入库）
 *
 * 支持 LARK_BOT_SETTINGS_PATH 环境变量覆盖默认路径（用于测试）。
 * 默认路径：<项目根>/.pi/settings.json。
 */
function readSettings(): any {
  try {
    const settingsPath =
      process.env.LARK_BOT_SETTINGS_PATH ?? join(root, ".pi", "settings.json");
    if (!existsSync(settingsPath)) return {};
    return JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * spawn lark-cli event consume 子进程。
 *
 * 实测 3 修正：lark-cli event consume 输出主要在 stderr（不是 stdout）。
 * 必须同时监听 stderr + stdout，避免丢事件。
 *
 * 事件接收（PR-2 完整实装）：
 *   - 解析 NDJSON → 按 chatId 路由 → pendingEvents.set(chatId, queue)
 *   - 飞书事件到达时建立 chatToSession 映射
 */
function spawnLarkCliEventConsume(): ChildProcess {
  const larkCli = spawn("lark-cli", ["event", "consume", "im.message.receive_v1"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 实测 3：同时监听 stderr（主输出）+ stdout（兜底）
  larkCli.stdout?.on("data", (d: Buffer) => {
    onLarkEvent(d.toString("utf-8"), "stdout");
  });
  larkCli.stderr?.on("data", (d: Buffer) => {
    onLarkEvent(d.toString("utf-8"), "stderr");
  });

  larkCli.on("error", (err) => {
    console.error(`[lark-bot ext] lark-cli spawn 失败: ${err.message}`);
  });

  return larkCli;
}

/**
 * 处理 lark-cli 输出。
 *
 * issue#184 完整实装：
 *   - 解析 NDJSON（按行）
 *   - 按 chatId 路由到 pendingEvents Map
 *   - msgId → chatId 反向索引（pendingEventsByMsgId）
 *   - ensureTempSession：占用 temp slot + 设置鉴权窗口
 *
 * 内存保护：PENDING_EVENTS_MAX_SIZE 超过时清空整个 Map（防 lark-cli 事件积压）。
 */
function onLarkEvent(raw: string, source: "stdout" | "stderr"): void {
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as ExtLarkEvent;
      // 仅处理 p2p text 事件（群聊事件 / 非文本事件不入 pendingEvents）
      if (event.chat_type !== "p2p") continue;
      if (event.message_type !== "text") continue;
      // 路由到 pendingEvents
      const queue = (pendingEvents.get(event.chat_id) as ExtLarkEvent[] | undefined) ?? [];
      queue.push(event);
      pendingEvents.set(event.chat_id, queue);
      pendingEventsByMsgId.set(event.message_id, event.chat_id);
      // 占 temp slot + 鉴权窗口
      const ensureResult = ensureTempSession(event.chat_id, event.message_id);
      if (!ensureResult.ok) {
        // temp 配额满：事件仍路由到 pendingEvents（供 PI Agent 后续轮询），
        // 但 session 不创建 — PI Agent 收到事件后调 registerTool 时会被域检查拒绝。
        console.error(`[lark-bot ext] ${ensureResult.error} chatId=${event.chat_id.slice(-12)}`);
      }
    } catch {
      // 非 JSON 行忽略（PR-1 容错：lark-cli 输出可能含提示行）
    }
  }
  // 内存保护
  if (pendingEventsByMsgId.size > PENDING_EVENTS_MAX_SIZE) {
    pendingEventsByMsgId.clear();
    pendingEvents.clear();
    console.error(`[lark-bot ext] pendingEvents cleared (size > ${PENDING_EVENTS_MAX_SIZE})`);
  }
}

/**
 * 启动旧 lark-bot 进程（回滚路径）。
 *
 * 当 useExtensionMode=false 且 autoStart=true 时启用。
 * 保留 PR-1 之前代码路径，便于快速回滚。
 */
async function startLegacyLarkBotProcess(): Promise<void> {
  const script = join(root, ".pi", "scripts", "lark-bot", "main.ts");
  const nodeBin = process.execPath;
  const tsxEntry = join(root, ".pi", "npm", "node_modules", "tsx", "dist", "cli.mjs");

  if (!existsSync(script)) {
    console.error("[lark-bot ext] 旧路径脚本不存在:", script);
    return;
  }

  console.error("[lark-bot ext] 启动旧 lark-bot 进程（回滚路径）...");

  const proc = spawn(nodeBin, [tsxEntry, script], {
    cwd: root,
    stdio: ["pipe", "ignore", "ignore"],
    env: process.env,
    detached: process.platform !== "win32",
    windowsHide: process.platform === "win32",
  });

  // 实测 6-3：纳入 children registry，session_shutdown 时手动 kill
  trackChild(proc);

  proc.on("exit", (code) => {
    console.error(`[lark-bot ext] 旧 lark-bot 进程退出 (code=${code})`);
  });

  proc.on("error", (err) => {
    console.error(`[lark-bot ext] 旧 lark-bot 进程启动失败: ${err.message}`);
  });
}
