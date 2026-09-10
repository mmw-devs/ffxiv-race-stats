// extensions/lark-bot/__tests__/index.test.ts
//
// Extension 主测试 — PR-1 registerTool 调用契约 + useExtensionMode 分支
// 覆盖：
//   - 8 个 registerTool 注册（smoke test：调用 execute 返回正确结构）
//   - useExtensionMode=false → 启动旧 lark-bot 进程
//   - useExtensionMode=true → 启动 lark-cli event consume（实测 3 修正）
//   - session_shutdown → killAllChildren + 清空 module-level 状态
//   - autoStart=false + useExtensionMode=false → 跳过启动
//   - LARK_BOT_RUNTIME=1 → 防递归跳过

import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ═══════════════ Mocks ═══════════════

// Mock protocol/feishu.ts — 让 addReaction / delReaction / sendReplyGetId 可控
vi.mock("../../../scripts/lark-bot/protocol/feishu.js", () => ({
  addReaction: vi.fn(() => "reaction-id-123"),
  delReaction: vi.fn(),
  sendReplyGetId: vi.fn(async () => ({ ok: true, replyId: "reply-id-456" })),
}));

// Mock broadcast/group-tool.ts — 工厂返回 mock instance
vi.mock("../../../scripts/lark-bot/broadcast/group-tool.js", () => ({
  createGroupTool: vi.fn(() => ({
    getGroupInfo: vi.fn(async () => ({ chatId: "oc_test", name: "Test Group", description: "desc" })),
    listGroupMembers: vi.fn(async () => ["ou_user1", "ou_user2"]),
    sendGroupMessage: vi.fn(async () => ({ ok: true, messageId: "msg-id-789" })),
    listAllBotGroups: vi.fn(async () => [
      { chatId: "oc_g1", name: "Group 1", description: "d1" },
      { chatId: "oc_g2", name: "Group 2", description: "" },
    ]),
  })),
}));

// PR-2：Mock auth.ts / broadcast.ts / identity-resolver.ts / session-manager.ts
// 这些是 index.ts 新增的依赖；不 mock 会触发实际模块加载（包含 fs / lark-cli 调用）
vi.mock("../../../scripts/lark-bot/business/auth.js", () => ({
  createAuthModule: vi.fn(() => ({
    initBoot: vi.fn(),
    authorize: vi.fn(async () => ({ status: "matched", groupId: "oc_test", groupName: "Test Group", description: "desc" })),
    onChatAdded: vi.fn(),
    onChatDeleted: vi.fn(),
    onUserAdded: vi.fn(),
    onUserDeleted: vi.fn(),
    onChatUpdated: vi.fn(),
    onChatDisbanded: vi.fn(),
    groupCount: vi.fn(() => 1),
  })),
}));

vi.mock("../../../scripts/lark-bot/business/broadcast.js", () => ({
  createBroadcastModule: vi.fn(() => ({
    announce: vi.fn(async () => ({ ok: true, messageId: "msg-broadcast-test" })),
  })),
}));

vi.mock("../../../scripts/lark-bot/identity-resolver.js", () => ({
  createIdentityResolver: vi.fn(() => ({
    resolveOperator: vi.fn(async () => ({ operator: "38a32652", claim: "user_id", name: "weunimix" })),
    clearCache: vi.fn(),
    cacheSize: vi.fn(() => 0),
  })),
}));

vi.mock("../../../scripts/lark-bot/interactive/session-manager.js", () => ({
  tryReserveAuthorizedSlot: vi.fn(() => true),
  releaseAuthorizedSlot: vi.fn(),
}));

// Mock children-registry — 隔离进程管理副作用
vi.mock("../process/children-registry.js", () => ({
  trackChild: vi.fn(),
  killAllChildren: vi.fn(() => 0),
}));

import extensionFn from "../index.js";

// ═══════════════ Test helpers ═══════════════

interface MockPi {
  handlers: Map<string, Array<(event: any, ctx: any) => any>>;
  tools: Map<string, any>;
  on: (event: string, handler: any) => void;
  registerTool: (tool: any) => void;
}

function createMockPi(): MockPi {
  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const tools = new Map<string, any>();
  return {
    handlers,
    tools,
    on(event: string, handler: any) {
      const arr = handlers.get(event) ?? [];
      arr.push(handler);
      handlers.set(event, arr);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
  };
}

// ═══════════════ Tests ═══════════════

describe("extension — 15 个 registerTool 注册（PR-1 + PR-2 + PR-4）", () => {
  let mockPi: MockPi;

  beforeEach(() => {
    mockPi = createMockPi();
    extensionFn(mockPi as any);
  });

  it("注册 15 个 registerTool（7 个 feishu_* + 8 个 larkbot_*）", () => {
    expect(mockPi.tools.size).toBe(15);
    const expectedTools = [
      // PR-1：feishu_* 7 个
      "feishu_add_reaction",
      "feishu_remove_reaction",
      "feishu_send_reply",
      "feishu_get_group_info",
      "feishu_list_group_members",
      "feishu_send_group_message",
      "feishu_list_bot_groups",
      // PR-2：larkbot_* 鉴权 4 个
      "larkbot_list_candidate_groups",
      "larkbot_authorize_user",
      "larkbot_resolve_operator",
      "larkbot_get_chat_auth_state",
      // PR-4：larkbot_* 任务日志 4 个
      "larkbot_record_change",
      "larkbot_commit_changes",
      "larkbot_close_business_session",
      "larkbot_query_journal",
    ];
    for (const name of expectedTools) {
      expect(mockPi.tools.has(name)).toBe(true);
    }
  });

  it("每个 registerTool 都有 name / label / description / parameters / execute", () => {
    for (const [name, tool] of mockPi.tools) {
      expect(tool.name, `${name} name`).toBe(name);
      expect(typeof tool.label, `${name} label`).toBe("string");
      expect(typeof tool.description, `${name} description`).toBe("string");
      expect(tool.parameters, `${name} parameters`).toBeDefined();
      expect(typeof tool.execute, `${name} execute`).toBe("function");
    }
  });

  it("registerTool.description 含 PR-1/PR-2/PR-3/PR-4 标识", () => {
    for (const [name, tool] of mockPi.tools) {
      expect(tool.description, `${name} description`).toMatch(/PR-(1|2|3|4)/);
    }
  });
});

describe("extension — registerTool execute 调用契约", () => {
  let mockPi: MockPi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = createMockPi();
    extensionFn(mockPi as any);
  });

  it("feishu_add_reaction 调用 addReaction 返回 ok", async () => {
    const tool = mockPi.tools.get("feishu_add_reaction");
    const result = await tool.execute("call-1", { msgId: "om_msg1", emoji: "WAVE" });
    expect(result.details.ok).toBe(true);
    expect(result.details.reactionId).toBe("reaction-id-123");
    expect(result.content[0].text).toContain("WAVE");
  });

  it("feishu_add_reaction 失败时返回 isError: true", async () => {
    // 临时 mock addReaction 返回 null
    const { addReaction } = await import("../../../scripts/lark-bot/protocol/feishu.js");
    vi.mocked(addReaction).mockReturnValueOnce(null);

    const tool = mockPi.tools.get("feishu_add_reaction");
    const result = await tool.execute("call-1", { msgId: "om_msg1", emoji: "FAIL" });
    expect(result.details.ok).toBe(false);
    expect(result.isError).toBe(true);
  });

  it("feishu_send_reply 调用 sendReplyGetId 返回 replyId", async () => {
    const tool = mockPi.tools.get("feishu_send_reply");
    const result = await tool.execute("call-2", { msgId: "om_msg2", text: "hello" });
    expect(result.details.ok).toBe(true);
    expect(result.details.replyId).toBe("reply-id-456");
  });

  it("feishu_send_reply 超时时返回 timedOut", async () => {
    const { sendReplyGetId } = await import("../../../scripts/lark-bot/protocol/feishu.js");
    vi.mocked(sendReplyGetId).mockResolvedValueOnce({
      ok: false,
      replyId: null,
      error: "timeout",
      timedOut: true,
    });

    const tool = mockPi.tools.get("feishu_send_reply");
    const result = await tool.execute("call-2", { msgId: "om_msg2", text: "hello" });
    expect(result.details.ok).toBe(false);
    expect(result.details.timedOut).toBe(true);
    expect(result.isError).toBe(true);
  });

  it("feishu_list_bot_groups 返回群组列表", async () => {
    const tool = mockPi.tools.get("feishu_list_bot_groups");
    const result = await tool.execute("call-3", {});
    expect(result.details.ok).toBe(true);
    expect(result.details.groups).toHaveLength(2);
  });

  it("larkbot_fetch_pending_events PR-1-cleanup 后不再提供（PR-2 实装）", () => {
    // PR-1-cleanup：larkbot_fetch_pending_events 已删除，PR-2 完整实装飞书 WS 桥接时再加。
    // 验证工具未注册即可。
    const mockPi2 = createMockPi();
    extensionFn(mockPi2 as any);
    expect(mockPi2.tools.has("larkbot_fetch_pending_events")).toBe(false);
  });
});

describe("extension — session_start 启动逻辑", () => {
  let mockPi: MockPi;
  const originalEnv = process.env.LARK_BOT_RUNTIME;
  const originalSettings: string | undefined = process.env.LARK_BOT_SETTINGS_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = createMockPi();
    process.env.LARK_BOT_RUNTIME = "";
    // 通过环境变量让 readSettings 读取特定 settings.json（PR-1-cleanup 起支持）
    process.env.LARK_BOT_SETTINGS_PATH = "";
  });

  afterEach(() => {
    process.env.LARK_BOT_RUNTIME = originalEnv;
    process.env.LARK_BOT_SETTINGS_PATH = originalSettings;
  });

  it("LARK_BOT_RUNTIME=1 时跳过启动（防递归）", async () => {
    process.env.LARK_BOT_RUNTIME = "1";
    extensionFn(mockPi as any);

    const handlers = mockPi.handlers.get("session_start") ?? [];
    await handlers[0]({ reason: "startup" }, {});

    // 不应调用 trackChild（无子进程注册）
    const { trackChild } = await import("../process/children-registry.js");
    expect(trackChild).not.toHaveBeenCalled();
  });

  it("settings 不存在 + autoStart 未设时跳过启动", async () => {
    // 不设置 LARK_BOT_SETTINGS_PATH，readSettings 返回 {}（settings.json 不存在则返空）
    process.env.LARK_BOT_SETTINGS_PATH = "/tmp/non-existent-settings.json";
    extensionFn(mockPi as any);

    const handlers = mockPi.handlers.get("session_start") ?? [];
    await handlers[0]({ reason: "startup" }, {});

    const { trackChild } = await import("../process/children-registry.js");
    expect(trackChild).not.toHaveBeenCalled();
  });

  it("autoStart=true + useExtensionMode=false 走旧路径（spawn lark-cli main.ts）", async () => {
    // 通过临时 settings.json 启用回滚路径
    const tmpSettings = "/tmp/lark-bot-test-settings-autostart-rollback.json";
    require("node:fs").writeFileSync(
      tmpSettings,
      JSON.stringify({ larkBot: { autoStart: true, useExtensionMode: false } }),
    );
    process.env.LARK_BOT_SETTINGS_PATH = tmpSettings;
    extensionFn(mockPi as any);

    const handlers = mockPi.handlers.get("session_start") ?? [];
    await handlers[0]({ reason: "startup" }, {});

    // 旧路径 spawn 独立 lark-bot 进程 → trackChild 被调用
    const { trackChild } = await import("../process/children-registry.js");
    expect(trackChild).toHaveBeenCalled();

    // 清理临时文件
    require("node:fs").unlinkSync(tmpSettings);
  });

  it("autoStart=true + useExtensionMode=true 走新路径（spawn lark-cli event consume）", async () => {
    const tmpSettings = "/tmp/lark-bot-test-settings-autostart-extension.json";
    require("node:fs").writeFileSync(
      tmpSettings,
      JSON.stringify({ larkBot: { autoStart: true, useExtensionMode: true } }),
    );
    process.env.LARK_BOT_SETTINGS_PATH = tmpSettings;
    extensionFn(mockPi as any);

    const handlers = mockPi.handlers.get("session_start") ?? [];
    await handlers[0]({ reason: "startup" }, {});

    // 新路径 spawn lark-cli event consume → trackChild 也被调用
    const { trackChild } = await import("../process/children-registry.js");
    expect(trackChild).toHaveBeenCalled();

    require("node:fs").unlinkSync(tmpSettings);
  });

  it("session_start reason !== startup 时跳过", async () => {
    extensionFn(mockPi as any);

    const handlers = mockPi.handlers.get("session_start") ?? [];
    await handlers[0]({ reason: "reload" }, {});

    const { trackChild } = await import("../process/children-registry.js");
    expect(trackChild).not.toHaveBeenCalled();
  });
});

describe("extension — session_shutdown 清理逻辑", () => {
  let mockPi: MockPi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = createMockPi();
    extensionFn(mockPi as any);
  });

  it("session_shutdown 触发 killAllChildren（实测 6-3 强制要求）", async () => {
    const handlers = mockPi.handlers.get("session_shutdown") ?? [];
    await handlers[0]({ reason: "quit" }, {});

    const { killAllChildren } = await import("../process/children-registry.js");
    expect(killAllChildren).toHaveBeenCalledWith();
  });

  it("session_shutdown 不抛错", async () => {
    const handlers = mockPi.handlers.get("session_shutdown") ?? [];
    await expect(handlers[0]({ reason: "quit" }, {})).resolves.not.toThrow();
  });
});
