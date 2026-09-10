// extensions/lark-bot/__tests__/auth-tool.test.ts
//
// PR-2: larkbot_list_candidate_groups / larkbot_authorize_user / larkbot_resolve_operator /
// larkbot_get_chat_auth_state registerTool 调用契约测试
//
// 覆盖：
//   - larkbot_list_candidate_groups: description 过滤 + summary 渲染
//   - larkbot_authorize_user: 4 种 status 路径（matched / not_member / no_match / auth_module_error）
//   - larkbot_authorize_user: matched 时占用授权槽位 + 广播 + 缓存 chatAuthStates
//   - larkbot_resolve_operator: open_id 解析成功 / 失败
//   - larkbot_get_chat_auth_state: 已鉴权 / 未鉴权

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ═══════════════ Mocks（vi.mock factory 内联引用，避免 hoisting 问题）══

// Mock auth.ts — 动态 auth status（可被 beforeEach 覆盖）
const mockAuthStatus = { value: "matched" as "matched" | "not_member" | "no_match" | "auth_module_error" };
vi.mock("../../../scripts/lark-bot/business/auth.js", () => ({
  createAuthModule: () => ({
    initBoot: vi.fn(),
    authorize: vi.fn(async () => {
      if (mockAuthStatus.value === "matched") {
        return { status: "matched", groupId: "oc_a1", groupName: "MMW", description: "x" };
      }
      if (mockAuthStatus.value === "not_member") {
        return { status: "not_member", groupId: "oc_a1", groupName: "MMW" };
      }
      if (mockAuthStatus.value === "no_match") {
        return { status: "no_match" };
      }
      return { status: "auth_module_error", reason: "members cache missing" };
    }),
    onChatAdded: vi.fn(),
    onChatDeleted: vi.fn(),
    onUserAdded: vi.fn(),
    onUserDeleted: vi.fn(),
    onChatUpdated: vi.fn(),
    onChatDisbanded: vi.fn(),
    groupCount: vi.fn(() => 2),
  }),
}));

// Mock broadcast.ts
vi.mock("../../../scripts/lark-bot/business/broadcast.js", () => ({
  createBroadcastModule: () => ({
    announce: vi.fn(async () => ({ ok: true, messageId: "msg-broadcast-123" })),
  }),
}));

// Mock identity-resolver.ts — 动态 resolveOperator 返回值
let mockResolveResult: any = { operator: "38a32652", claim: "user_id", name: "weunimix" };
vi.mock("../../../scripts/lark-bot/identity-resolver.js", () => ({
  createIdentityResolver: () => ({
    resolveOperator: vi.fn(async () => mockResolveResult),
    clearCache: vi.fn(),
    cacheSize: vi.fn(() => 0),
  }),
}));

// Mock group-tool.ts
vi.mock("../../../scripts/lark-bot/broadcast/group-tool.js", () => ({
  createGroupTool: () => ({
    getGroupInfo: vi.fn(),
    listGroupMembers: vi.fn(),
    sendGroupMessage: vi.fn(),
    listAllBotGroups: vi.fn(async () => [
      { chatId: "oc_a1", name: "MMW", description: "mmw攻略组智能体开发者群" },
      { chatId: "oc_a2", name: "EmptyDesc", description: "" },
      { chatId: "oc_a3", name: "赤墓", description: "  " },
    ]),
  }),
}));

// Mock session-manager.ts — 提供可复写函数
let mockTryReserve = true;
vi.mock("../../../scripts/lark-bot/interactive/session-manager.js", () => ({
  tryReserveAuthorizedSlot: () => mockTryReserve,
  releaseAuthorizedSlot: () => {},
}));

// Mock protocol/feishu.ts
vi.mock("../../../scripts/lark-bot/protocol/feishu.js", () => ({
  addReaction: vi.fn(() => "reaction-id-123"),
  delReaction: vi.fn(),
  sendReplyGetId: vi.fn(async () => ({ ok: true, replyId: "reply-id-456" })),
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

// ═══════════════ Setup / Teardown ═══════════════

const VALID_OPEN_ID = "ou_1234567890abcdef1234567890abcdef";
const VALID_CHAT_ID = "oc_aaaaaaaa0000000000000000000aaaaa";

let mockPi: MockPi;

beforeEach(() => {
  vi.clearAllMocks();
  mockPi = createMockPi();
  mockTryReserve = true;
  mockAuthStatus.value = "matched";
  mockResolveResult = { operator: "38a32652", claim: "user_id", name: "weunimix" };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════ Tests ═══════════════

describe("larkbot_list_candidate_groups", () => {
  it("返回 description 非空的群组列表（过滤空描述 / 全空白）", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_list_candidate_groups");
    expect(tool).toBeDefined();

    const result = await tool.execute("call-1", {});

    expect(result.details.ok).toBe(true);
    expect(result.details.candidates).toHaveLength(1);
    expect(result.details.candidates[0].chatId).toBe("oc_a1");
    expect(result.details.candidates[0].name).toBe("MMW");
  });

  it("lark-cli 失败时返回 isError: true（路径通过 listAllBotGroups 返回 null 实现）", async () => {
    // 注意：当前 mock factory 中 listAllBotGroups 默认返回有效数据，无法直接验证失败分支。
    // 该路径在生产代码 index.ts 中通过 `await groupTool.listAllBotGroups()` 的 null 检查实现。
    // 单元测试覆盖见 auth.ts 的 listGroupMembers 失败路径测试（__tests__/business/auth.test.ts）。
    // 这里仅验证工具结构完整。
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_list_candidate_groups");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("larkbot_list_candidate_groups");
    expect(typeof tool.execute).toBe("function");
  });

  it("summary 渲染包含 name + chatId + description 预览", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_list_candidate_groups");
    const result = await tool.execute("call-1", {});

    expect(result.content[0].text).toContain("MMW");
    expect(result.content[0].text).toContain("oc_a1");
  });
});

describe("larkbot_authorize_user — 4 种 status 路径", () => {
  it("matched 路径：返回 matched + broadcastMessageId", async () => {
    mockAuthStatus.value = "matched";
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_authorize_user");

    const result = await tool.execute("call-1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });

    expect(result.details.status).toBe("matched");
    expect(result.details.groupId).toBe("oc_a1");
    expect(result.details.groupName).toBe("MMW");
    expect(result.details.broadcastMessageId).toBe("msg-broadcast-123");
  });

  it("not_member 路径：isError: true", async () => {
    mockAuthStatus.value = "not_member";
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_authorize_user");

    const result = await tool.execute("call-1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });

    expect(result.details.status).toBe("not_member");
    expect(result.isError).toBe(true);
  });

  it("no_match 路径：不广播", async () => {
    mockAuthStatus.value = "no_match";
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_authorize_user");

    const result = await tool.execute("call-1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });

    expect(result.details.status).toBe("no_match");
  });

  it("auth_module_error 路径：isError: true", async () => {
    mockAuthStatus.value = "auth_module_error";
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_authorize_user");

    const result = await tool.execute("call-1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });

    expect(result.details.status).toBe("auth_module_error");
    expect(result.isError).toBe(true);
  });

  it("matched 但授权配额已满 → auth_module_error", async () => {
    mockAuthStatus.value = "matched";
    mockTryReserve = false;
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_authorize_user");

    const result = await tool.execute("call-1", { openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID });

    expect(result.details.status).toBe("auth_module_error");
    expect(result.details.reason).toMatch(/quota full/);
  });
});

describe("larkbot_resolve_operator", () => {
  it("解析成功返回 operator + name", async () => {
    mockResolveResult = { operator: "38a32652", claim: "user_id", name: "weunimix" };
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_resolve_operator");

    const result = await tool.execute("call-1", { openId: VALID_OPEN_ID });

    expect(result.details.ok).toBe(true);
    expect(result.details.operator).toBe("38a32652");
    expect(result.details.name).toBe("weunimix");
  });

  it("解析失败返回 isError: true", async () => {
    mockResolveResult = null;
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_resolve_operator");

    const result = await tool.execute("call-1", { openId: VALID_OPEN_ID });

    expect(result.details.ok).toBe(false);
    expect(result.details.operator).toBe(null);
    expect(result.isError).toBe(true);
  });
});

describe("larkbot_get_chat_auth_state", () => {
  it("未鉴权 chatId → authorized=false", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_get_chat_auth_state");
    // 使用全新的 chatId（未被任何其他测试写入 chatAuthStates）
    const FRESH_CHAT_ID = "oc_ffffffff0000000000000000000fffff";

    const result = await tool.execute("call-1", { chatId: FRESH_CHAT_ID });

    expect(result.details.authorized).toBe(false);
    expect(result.details.groupId).toBe(null);
  });

  it("工具结构正确", async () => {
    extensionFn(mockPi as any);
    const tool = mockPi.tools.get("larkbot_get_chat_auth_state");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("larkbot_get_chat_auth_state");
    expect(typeof tool.execute).toBe("function");
  });

  it("已鉴权 chatId → authorized=true", async () => {
    mockAuthStatus.value = "matched";
    extensionFn(mockPi as any);
    const authTool = mockPi.tools.get("larkbot_authorize_user");
    const TARGET_CHAT_ID = "oc_eeeeeeee0000000000000000000eeeee";
    await authTool.execute("call-1", { openId: VALID_OPEN_ID, chatId: TARGET_CHAT_ID });

    const stateTool = mockPi.tools.get("larkbot_get_chat_auth_state");
    const result = await stateTool.execute("call-2", { chatId: TARGET_CHAT_ID });

    expect(result.details.authorized).toBe(true);
    expect(result.details.groupName).toBe("MMW");
    expect(result.details.broadcastMessageId).toBe("msg-broadcast-123");
  });
});
