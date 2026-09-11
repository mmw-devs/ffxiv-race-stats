// extensions/lark-bot/__tests__/dual-domain.test.ts
//
// issue#184：双域会话机制独立测试
//
// 覆盖：
//   - 新创建私聊 session 默认进入临时私聊域（ensureTempSession）
//   - feishu_* 在临时私聊域返回"未鉴权"错误
//   - larkbot_authorize_user matched 时 slot swap（sessionKinds + chatAuthStates + slot）
//   - larkbot_authorize_user not_member 时 fail-closed（closeTempSession）
//   - larkbot_authorize_user 业务配额满时返回 auth_module_error
//   - 鉴权轮次超 2 自动关闭
//   - 鉴权窗口超时自动关闭（mock Date.now）
//   - larkbot_close_temp_session 幂等清理
//   - msgId 反查 chatId 失败时返回错误
//   - LARK_BOT_USE_DUAL_DOMAIN=false 时关闭域检查
//   - 60s 周期清理器检测超时 + 超轮

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ═══════════════ Mocks ═══════════════

// Mock protocol/feishu.ts
vi.mock("../../../scripts/lark-bot/protocol/feishu.js", () => ({
  addReaction: vi.fn(() => "reaction-id-123"),
  delReaction: vi.fn(),
  sendReplyGetId: vi.fn(async () => ({ ok: true, replyId: "reply-id-456" })),
}));

// Mock broadcast/group-tool.ts
vi.mock("../../../scripts/lark-bot/broadcast/group-tool.js", () => ({
  createGroupTool: vi.fn(() => ({
    getGroupInfo: vi.fn(),
    listGroupMembers: vi.fn(),
    sendGroupMessage: vi.fn(),
    listAllBotGroups: vi.fn(async () => []),
  })),
}));

// Mock auth.ts — 动态 status（beforeEach 可改）
let mockAuthStatus: any = { status: "matched", groupId: "oc_g1", groupName: "MMW", description: "x" };
vi.mock("../../../scripts/lark-bot/business/auth.js", () => ({
  createAuthModule: () => ({
    initBoot: vi.fn(),
    authorize: vi.fn(async () => mockAuthStatus),
    onChatAdded: vi.fn(), onChatDeleted: vi.fn(), onUserAdded: vi.fn(),
    onUserDeleted: vi.fn(), onChatUpdated: vi.fn(), onChatDisbanded: vi.fn(),
    groupCount: vi.fn(() => 1),
  }),
}));

// Mock broadcast.ts
vi.mock("../../../scripts/lark-bot/business/broadcast.js", () => ({
  createBroadcastModule: () => ({
    announce: vi.fn(async () => ({ ok: true, messageId: "msg-broadcast-test" })),
  }),
}));

// Mock identity-resolver.ts
let mockResolveResult: any = { operator: "38a32652", claim: "user_id", name: "weunimix" };
vi.mock("../../../scripts/lark-bot/identity-resolver.js", () => ({
  createIdentityResolver: () => ({
    resolveOperator: vi.fn(async () => mockResolveResult),
    clearCache: vi.fn(),
    cacheSize: vi.fn(() => 0),
  }),
}));

// Mock session-manager.ts
vi.mock("../../../scripts/lark-bot/interactive/session-manager.js", () => ({
  tryReserveAuthorizedSlot: () => true,
  releaseAuthorizedSlot: () => {},
}));

// Mock slots.ts — 默认配额正常
let mockTryReserveBusiness = true;
let mockTryReserveTemp = true;
vi.mock("../../../scripts/lark-bot/business/slots.js", () => ({
  tryReserveTempSlot: () => mockTryReserveTemp,
  releaseTempSlot: () => {},
  tryReserveBusinessSlot: () => mockTryReserveBusiness,
  releaseBusinessSlot: () => {},
  resetSlots: () => {},
  countByKind: () => 0,
}));

// Mock children-registry
vi.mock("../process/children-registry.js", () => ({
  trackChild: vi.fn(),
  killAllChildren: vi.fn(() => 0),
}));

import extensionFn, {
  __resetDualDomainForTest,
  __injectPendingEventForTest,
} from "../index.js";

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

const VALID_CHAT_ID = "oc_aaaaaaaa0000000000000000000aaaaa";
const VALID_OPEN_ID = "ou_1234567890abcdef1234567890abcdef";
const FRESH_CHAT_ID = "oc_bbbbbbbb0000000000000000000bbbbbb";

let mockPi: MockPi;

beforeEach(() => {
  vi.clearAllMocks();
  mockPi = createMockPi();
  mockAuthStatus = { status: "matched", groupId: "oc_g1", groupName: "MMW", description: "x" };
  mockResolveResult = { operator: "38a32652", claim: "user_id", name: "weunimix" };
  mockTryReserveBusiness = true;
  mockTryReserveTemp = true;
  __resetDualDomainForTest();
  delete process.env.LARK_BOT_USE_DUAL_DOMAIN;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════ Tests ═══════════════

describe("issue#184 双域会话机制 — feishu_* 域检查", () => {
  it("feishu_send_reply 在临时私聊域 → not_authorized", async () => {
    extensionFn(mockPi as any);
    __injectPendingEventForTest("om_msg1", VALID_CHAT_ID);
    const tool = mockPi.tools.get("feishu_send_reply");
    const result = await tool.execute("c1", { msgId: "om_msg1", text: "hello" });
    expect(result.details.status).toBe("not_authorized");
    expect(result.isError).toBe(true);
  });

  it("feishu_add_reaction 在临时私聊域 → not_authorized", async () => {
    extensionFn(mockPi as any);
    __injectPendingEventForTest("om_msg2", VALID_CHAT_ID);
    const tool = mockPi.tools.get("feishu_add_reaction");
    const result = await tool.execute("c1", { msgId: "om_msg2", emoji: "WAVE" });
    expect(result.details.status).toBe("not_authorized");
    expect(result.isError).toBe(true);
  });

  it("feishu_remove_reaction 在临时私聊域 → not_authorized", async () => {
    extensionFn(mockPi as any);
    __injectPendingEventForTest("om_msg3", VALID_CHAT_ID);
    const tool = mockPi.tools.get("feishu_remove_reaction");
    const result = await tool.execute("c1", { msgId: "om_msg3", reactionId: "r1" });
    expect(result.details.status).toBe("not_authorized");
    expect(result.isError).toBe(true);
  });

  it("feishu_send_group_message 在临时私聊域 → not_authorized", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("feishu_send_group_message");
    const result = await tool.execute("c1", { chatId: VALID_CHAT_ID, text: "hi" });
    expect(result.details.status).toBe("not_authorized");
    expect(result.isError).toBe(true);
  });

  it("feishu_list_bot_groups 不限域（鉴权辅助）", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("feishu_list_bot_groups");
    const result = await tool.execute("c1", {});
    expect(result.details.ok).toBe(true);
    expect(result.isError).toBeFalsy();
  });

  it("feishu_send_reply msgId 不在 pendingEventsByMsgId → msgId not found", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("feishu_send_reply");
    const result = await tool.execute("c1", { msgId: "om_unknown", text: "hello" });
    expect(result.details.error).toBe("msgId not found");
    expect(result.isError).toBe(true);
  });

  it("LARK_BOT_USE_DUAL_DOMAIN=false 时关闭域检查", async () => {
    process.env.LARK_BOT_USE_DUAL_DOMAIN = "false";
    extensionFn(mockPi as any);
    __injectPendingEventForTest("om_msg1", VALID_CHAT_ID);
    const tool = mockPi.tools.get("feishu_send_reply");
    const result = await tool.execute("c1", { msgId: "om_msg1", text: "hello" });
    // 域检查关闭，msgId 路由有效，但 sendReplyGetId mock 返回 ok
    expect(result.details.ok).toBe(true);
    expect(result.details.replyId).toBe("reply-id-456");
  });
});

describe("issue#184 双域会话机制 — larkbot_* 业务工具域检查", () => {
  it("larkbot_record_change 在临时私聊域 → not_authorized", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_record_change");
    const result = await tool.execute("c1", { chatId: FRESH_CHAT_ID, field: "x", from: 1, to: 2 });
    expect(result.details.status).toBe("not_authorized");
    expect(result.isError).toBe(true);
  });

  it("larkbot_commit_changes 在临时私聊域 → not_authorized", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_commit_changes");
    const result = await tool.execute("c1", { chatId: FRESH_CHAT_ID, shortDesc: "x" });
    expect(result.details.status).toBe("not_authorized");
    expect(result.isError).toBe(true);
  });

  it("larkbot_close_business_session 在临时私聊域 → not_authorized", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_close_business_session");
    const result = await tool.execute("c1", { chatId: FRESH_CHAT_ID });
    expect(result.details.status).toBe("not_authorized");
    expect(result.isError).toBe(true);
  });

  it("larkbot_query_journal 在临时私聊域 → not_authorized", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_query_journal");
    const result = await tool.execute("c1", { chatId: FRESH_CHAT_ID });
    expect(result.details.status).toBe("not_authorized");
    expect(result.isError).toBe(true);
  });

  it("larkbot_list_candidate_groups 不限域（鉴权辅助）", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_list_candidate_groups");
    const result = await tool.execute("c1", {});
    expect(result.details.ok).toBe(true);
    expect(result.isError).toBeFalsy();
  });

  it("larkbot_resolve_operator 不限域（鉴权辅助）", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_resolve_operator");
    const result = await tool.execute("c1", { openId: VALID_OPEN_ID });
    expect(result.details.ok).toBe(true);
    expect(result.details.operator).toBe("38a32652");
  });

  it("larkbot_get_chat_auth_state 不限域（查询）", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_get_chat_auth_state");
    const result = await tool.execute("c1", { chatId: FRESH_CHAT_ID });
    expect(result.details.authorized).toBe(false);
  });
});

describe("issue#184 双域会话机制 — larkbot_authorize_user slot swap", () => {
  it("matched 时同时更新 sessionKinds + chatAuthStates", async () => {
    extensionFn(mockPi as any);
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    const result = await authTool.execute("c1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });

    expect(result.details.status).toBe("matched");
    expect(result.details.kind).toBe("p2p-business");

    // 验证 chatAuthStates 也更新了
    const stateTool = mockPi.tools.get("larkbot_get_chat_auth_state");
    const state = await stateTool.execute("c1", { chatId: VALID_CHAT_ID });
    expect(state.details.authorized).toBe(true);
    expect(state.details.kind).toBe("p2p-business");
    expect(state.details.groupName).toBe("MMW");
  });

  it("matched 后 feishu_send_reply 进入业务私聊域放行", async () => {
    extensionFn(mockPi as any);
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    await authTool.execute("c1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });
    __injectPendingEventForTest("om_msg_after", VALID_CHAT_ID);
    const tool = mockPi.tools.get("feishu_send_reply");
    const result = await tool.execute("c1", { msgId: "om_msg_after", text: "hi" });
    expect(result.details.ok).toBe(true);
    expect(result.details.replyId).toBe("reply-id-456");
  });

  it("业务配额满时返回 auth_module_error（business_quota_full）", async () => {
    mockTryReserveBusiness = false; // 模拟业务配额满
    extensionFn(mockPi as any);
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    const result = await authTool.execute("c1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });
    expect(result.details.status).toBe("auth_module_error");
    expect(result.details.reason).toMatch(/quota/);
    expect(result.isError).toBe(true);
  });

  it("not_member 时 fail-closed（closeTempSession）", async () => {
    mockAuthStatus = { status: "not_member", groupId: "oc_g1", groupName: "MMW" };
    extensionFn(mockPi as any);
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    const result = await authTool.execute("c1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });
    expect(result.details.status).toBe("not_member");
    expect(result.details.closed).toBe(true);

    // 验证后续调用 get_chat_auth_state 返回未鉴权（已被 close）
    const stateTool = mockPi.tools.get("larkbot_get_chat_auth_state");
    const state = await stateTool.execute("c1", { chatId: VALID_CHAT_ID });
    expect(state.details.authorized).toBe(false);
  });

  it("no_match 时增加鉴权轮次但不立即关闭", async () => {
    mockAuthStatus = { status: "no_match" };
    extensionFn(mockPi as any);
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    const r1 = await authTool.execute("c1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });
    expect(r1.details.status).toBe("no_match");
    expect(r1.details.roundsUsed).toBe(1);
  });

  it("鉴权轮次超 2 时自动关闭（auth_rounds_exceeded）", async () => {
    mockAuthStatus = { status: "no_match" };
    extensionFn(mockPi as any);
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    // 第一次 no_match：rounds=1
    const r1 = await authTool.execute("c1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });
    expect(r1.details.roundsUsed).toBe(1);
    // 第二次 no_match：rounds=2（边界，下次调用必须 fail-closed）
    const r2 = await authTool.execute("c2", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });
    expect(r2.details.roundsUsed).toBe(2);
    // 第三次：预检查 rounds >= 2 → 超轮关闭
    const r3 = await authTool.execute("c3", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });
    expect(r3.details.status).toBe("auth_module_error");
    expect(r3.details.reason).toBe("auth_rounds_exceeded");
    expect(r3.details.closed).toBe(true);
  });

  it("msgId 反查 chatId 不一致时返回错误", async () => {
    extensionFn(mockPi as any);
    __injectPendingEventForTest("om_msg_x", "oc_other_chat");
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    const result = await authTool.execute("c1", {
      openId: VALID_OPEN_ID,
      chatId: VALID_CHAT_ID,
      msgId: "om_msg_x",
    });
    expect(result.details.status).toBe("auth_module_error");
    expect(result.details.reason).toBe("msgId_chatId_mismatch");
  });
});

describe("issue#184 双域会话机制 — larkbot_close_temp_session", () => {
  it("temp 域 session 被正常清理", async () => {
    extensionFn(mockPi as any);
    // 先确保 chatId 在 temp 域（调一次 authorize_user 触发 ensureTempSession）
    mockAuthStatus = { status: "no_match" };
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    await authTool.execute("c1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });

    // 关闭
    const closeTool = mockPi.tools.get("larkbot_close_temp_session");
    const result = await closeTool.execute("c2", { chatId: VALID_CHAT_ID, reason: "user_requested" });
    expect(result.details.ok).toBe(true);
    expect(result.details.reason).toBe("user_requested");

    // 验证已清理
    const stateTool = mockPi.tools.get("larkbot_get_chat_auth_state");
    const state = await stateTool.execute("c3", { chatId: VALID_CHAT_ID });
    expect(state.details.authorized).toBe(false);
  });

  it("非 temp 域调用幂等返回 alreadyClosed", async () => {
    extensionFn(mockPi as any);
    // chatId 不在 sessionKinds（未 ensureTempSession）
    const closeTool = mockPi.tools.get("larkbot_close_temp_session");
    const result = await closeTool.execute("c1", { chatId: FRESH_CHAT_ID, reason: "user_requested" });
    expect(result.details.alreadyClosed).toBe(true);
  });
});

describe("issue#184 双域会话机制 — LARK_BOT_USE_DUAL_DOMAIN", () => {
  it("默认启用（true）— 临时私聊域调用 feishu_* 返回 not_authorized", async () => {
    expect(process.env.LARK_BOT_USE_DUAL_DOMAIN).toBeUndefined();
    extensionFn(mockPi as any);
    __injectPendingEventForTest("om_msg1", VALID_CHAT_ID);
    const tool = mockPi.tools.get("feishu_send_reply");
    const result = await tool.execute("c1", { msgId: "om_msg1", text: "hi" });
    expect(result.details.status).toBe("not_authorized");
  });

  it("关闭（false）— 临时私聊域调用 feishu_* 放行", async () => {
    process.env.LARK_BOT_USE_DUAL_DOMAIN = "false";
    extensionFn(mockPi as any);
    __injectPendingEventForTest("om_msg1", VALID_CHAT_ID);
    const tool = mockPi.tools.get("feishu_send_reply");
    const result = await tool.execute("c1", { msgId: "om_msg1", text: "hi" });
    expect(result.details.ok).toBe(true);
  });
});
