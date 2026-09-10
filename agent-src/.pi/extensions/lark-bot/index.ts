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
 *   5. children-registry.ts 跟踪所有子进程（实测 6-3）
 *   6. session_shutdown 手动 kill（实测 6-3）
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
import { PROJECT_DIR } from "../../scripts/lark-bot/config.js";
import { log as sharedLog } from "../../scripts/lark-bot/shared/logger.js";
import { tryReserveAuthorizedSlot, releaseAuthorizedSlot } from "../../scripts/lark-bot/interactive/session-manager.js";

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
 * 返回值间接感知鉴权结果。chatId 为 key，值为 {authorized, groupId, groupName, broadcastMessageId}。
 */
interface ChatAuthState {
  authorized: boolean;
  groupId: string | null;
  groupName: string | null;
  broadcastMessageId: string | null;
}
const chatAuthStates = new Map<string, ChatAuthState>();

// ═══════════════ Extension 主入口 ═══════════════

export default function (pi: any) {
  // ── 启动期（PR-1：保留 autoStart + 新增 useExtensionMode 分支） ──
  pi.on("session_start", async (event: any) => {
    if (event.reason !== "startup") return;

    // 防递归：被 PI Agent spawn 的子进程不再走扩展路径
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

    // PR-2：启动鉴权冷启动（拉全量群组 + 各群成员）。失败 → fail-fast。
    try {
      await extensionAuthModule.initBoot();
    } catch (err: any) {
      console.error(`[lark-bot ext] auth 冷启动失败: ${err?.message?.slice(0, 200)}`);
      throw err;
    }

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
    extensionIdentityResolver.clearCache();
  });

  // ═══════════════ registerTool 注册（PR-1: 8 个） ═══════════════

  // ── 1. feishu_add_reaction ──
  pi.registerTool({
    name: "feishu_add_reaction",
    label: "添加飞书消息表情",
    description:
      "为指定飞书消息添加 emoji 表情反应。返回 reaction_id 用于后续切换或删除。" +
      "常用 emoji: WAVE / THINKING / DONE / ERROR。" +
      "（PR-1: registerTool 替代 protocol/feishu.ts addReaction）",
    parameters: Type.Object({
      msgId: Type.String({ description: "飞书消息 ID" }),
      emoji: Type.String({ description: "emoji 类型，如 'WAVE'" }),
    }),
    execute: async (_toolCallId: string, params: { msgId: string; emoji: string }) => {
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
      "（PR-1: registerTool 替代 protocol/feishu.ts delReaction）",
    parameters: Type.Object({
      msgId: Type.String({ description: "飞书消息 ID" }),
      reactionId: Type.String({ description: "reaction_id（feishu_add_reaction 返回）" }),
    }),
    execute: async (_toolCallId: string, params: { msgId: string; reactionId: string }) => {
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
      "（PR-1: registerTool 替代 protocol/feishu.ts sendReplyGetId）",
    parameters: Type.Object({
      msgId: Type.String({ description: "飞书消息 ID" }),
      text: Type.String({ description: "回复内容", maxLength: 4000 }),
    }),
    execute: async (_toolCallId: string, params: { msgId: string; text: string }) => {
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
      "（PR-1: registerTool 替代 broadcast/group-tool.ts getGroupInfo）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书群组 chat_id" }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string }) => {
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
      "（PR-1: registerTool 替代 broadcast/group-tool.ts listGroupMembers）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书群组 chat_id" }),
    }),
    execute: async (_toolCallId: string, params: { chatId: string }) => {
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
      "（PR-1: registerTool 替代 broadcast/group-tool.ts sendGroupMessage）",
    parameters: Type.Object({
      chatId: Type.String({ description: "飞书群组 chat_id" }),
      text: Type.String({ description: "消息内容", maxLength: 4000 }),
      mention: Type.Optional(Type.String({ description: "@用户 open_id（可选）" })),
      replyTo: Type.Optional(Type.String({ description: "回复消息 message_id（可选）" })),
    }),
    execute: async (_toolCallId: string, params: { chatId: string; text: string; mention?: string; replyTo?: string }) => {
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
      "鉴权判定（PR-2）的候选群组数据源。失败返回 null。" +
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
      "matched 时自动占用授权槽位 + 广播到群组 + 缓存 chatAuthStates。" +
      "（PR-2: registerTool 替代 business/auth.ts authorize / substringMatch）",
    parameters: Type.Object({
      openId: Type.String({ description: "飞书用户 open_id" }),
      chatId: Type.String({ description: "LLM 决策的群组 chat_id" }),
    }),
    execute: async (_toolCallId: string, params: { openId: string; chatId: string }) => {
      const authResult = await extensionAuthModule.authorize({
        openId: params.openId,
        chatId: params.chatId,
      });

      // matched 时占用授权槽位 + 广播到群组 + 缓存 chatAuthStates
      if (authResult.status === "matched") {
        if (!tryReserveAuthorizedSlot()) {
          console.error(`[lark-bot ext] larkbot_authorize_user: 已鉴权会话配额已满 chatId=${params.chatId.slice(-12)}`);
          return {
            content: [{ type: "text", text: `❌ 鉴权通过但已鉴权会话配额已满` }],
            details: { status: "auth_module_error", reason: "authorized quota full" },
            isError: true,
          };
        }
        const broadcast = await extensionBroadcastModule.announce({
          openId: params.openId,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          outcome: "matched",
        });
        chatAuthStates.set(params.chatId, {
          authorized: true,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          broadcastMessageId: broadcast.ok ? (broadcast.messageId ?? null) : null,
        });
        return {
          content: [{ type: "text", text: `✅ 鉴权通过：group=${authResult.groupName} (${authResult.groupId})${broadcast.ok && broadcast.messageId ? ` broadcast=${broadcast.messageId.slice(-12)}...` : ""}` }],
          details: {
            status: "matched",
            groupId: authResult.groupId,
            groupName: authResult.groupName,
            broadcastMessageId: broadcast.messageId ?? null,
          },
        };
      }

      // not_member 时广播到群组
      if (authResult.status === "not_member") {
        await extensionBroadcastModule.announce({
          openId: params.openId,
          groupId: authResult.groupId,
          groupName: authResult.groupName,
          outcome: "not_member",
        });
        return {
          content: [{ type: "text", text: `❌ 你不在授权群组 "${authResult.groupName}" 中` }],
          details: { status: "not_member", groupId: authResult.groupId, groupName: authResult.groupName },
          isError: true,
        };
      }

      // no_match / auth_module_error 直接返回
      const errMsg =
        authResult.status === "no_match"
          ? `⚠ 未找到匹配的业务群组（chatId=${params.chatId.slice(-12)}）`
          : `❌ 鉴权模块异常：${authResult.reason}`;
      return {
        content: [{ type: "text", text: errMsg }],
        details: authResult,
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
}

// ═══════════════ 辅助函数 ═══════════════

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
 * PR-1 占位：仅日志，不入 pendingEvents Map。
 * PR-2 完整实装：解析 NDJSON → 按 chatId 路由 → pendingEvents.set。
 */
function onLarkEvent(raw: string, source: "stdout" | "stderr"): void {
  // PR-1 占位：限制日志长度，避免日志爆炸
  const preview = raw.length > 200 ? raw.slice(0, 200) + "..." : raw;
  console.error(`[lark-bot ext] lark-cli ${source}: ${preview}`);
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
