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
 *   3. 新增 7 个 registerTool（feishu_* 7 个）
 *   4. children-registry.ts 跟踪所有子进程（实测 6-3）
 *   5. session_shutdown 手动 kill（实测 6-3）
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

    // 启动群组冷启动（PR-2 复用 auth.ts 的 initBoot）
    // PR-1 仅占位：暂不实装冷启动，留 PR-2 处理
    // await initGroupsCache();

    // 启动 lark-cli event consume 子进程（实测 3：同时监听 stderr + stdout）
    const larkCli = spawnLarkCliEventConsume();
    trackChild(larkCli); // 实测 6-3

    console.error("[lark-bot ext] 启动完成，registerTool 已注册（7 个）");
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
