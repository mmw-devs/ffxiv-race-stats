// business/auth.test.ts — AuthModule 模块单元测试（PR-2 改造版）
//
// PR-2 改造：
//   - AuthInput 移除 businessDescription，新增 chatId（LLM 决策的 chatId）
//   - authorize() 改为仅做成员资格校验（不再做 substringMatch 决策）
//   - substringMatch / normalizeForMatch 函数保留作回滚路径后备，仍测试其行为
//   - 删除所有 substring 匹配决策相关测试
//
// 覆盖：openId 校验、chatId 校验、群组缓存、成员资格校验、事件增量更新
import { describe, expect, it, vi } from "vitest";

import type { GroupTool } from "../../broadcast/group-tool.js";
import type { GroupInfo } from "../../broadcast/group-tool.js";
import {
  createAuthModule,
  type AuthModule,
  type ChatAddedPayload,
  type ChatUpdatedPayload,
  type UserMembershipPayload,
  normalizeForMatch,
  substringMatch,
} from "../../business/auth.js";

// ═══════════════════ 测试基础设施 ═══════════════════

const VALID_OPEN_ID = "ou_1234567890abcdef1234567890abcdef";
const VALID_OPEN_ID_2 = "ou_2234567890abcdef1234567890abcdef";
const VALID_CHAT_ID_A = "oc_aaaaaaaa0000000000000000000aaaaa";
const VALID_CHAT_ID_B = "oc_bbbbbbbb0000000000000000000bbbbb";

function makeMockGroupTool(): GroupTool & {
  getGroupInfo: ReturnType<typeof vi.fn>;
  listGroupMembers: ReturnType<typeof vi.fn>;
  listAllBotGroups: ReturnType<typeof vi.fn>;
} {
  return {
    getGroupInfo: vi.fn(),
    listGroupMembers: vi.fn(),
    sendGroupMessage: vi.fn(),
    listAllBotGroups: vi.fn(),
  } as any;
}

function makeAuth(tool: GroupTool): AuthModule {
  return createAuthModule({ groupTool: tool, log: () => {} });
}

function makeGroup(chatId: string, name: string, description: string): GroupInfo {
  return { chatId, name, description };
}

// ═══════════════════ 归一化工具函数（PR-2 后保留作回滚后备） ═══════════════════

describe("normalizeForMatch（回滚后备）", () => {
  it("全角转半角", () => {
    expect(normalizeForMatch("ＭＭＷ攻略组")).toBe("mmw攻略组");
  });
  it("全角空格去除", () => {
    expect(normalizeForMatch("mmw\u3000攻略组")).toBe("mmw攻略组");
  });
  it("小写化", () => {
    expect(normalizeForMatch("MMW")).toBe("mmw");
  });
  it("去常见中英标点", () => {
    expect(normalizeForMatch("mmw攻略,组。")).toBe("mmw攻略组");
  });
  it("去空白", () => {
    expect(normalizeForMatch("  mmw  攻略  ")).toBe("mmw攻略");
  });
  it("复合场景", () => {
    expect(normalizeForMatch("  ＭＭＷ攻略，组！  ")).toBe("mmw攻略组");
  });
});

describe("substringMatch（回滚后备）", () => {
  it("精确匹配", () => {
    expect(substringMatch("mmw攻略组", "mmw攻略组")).toBe(true);
  });
  it("用户描述是群组描述的子串", () => {
    expect(substringMatch("mmw攻略", "mmw攻略组智能体开发者群")).toBe(true);
  });
  it("群组描述是用户描述的子串", () => {
    expect(substringMatch("mmw攻略组智能体开发者群", "智能体开发者")).toBe(true);
  });
  it("归一化后用户描述是群组描述的子串", () => {
    expect(substringMatch("ＭＭＷ攻略", "mmw攻略组智能体开发者群")).toBe(true);
  });
  it("归一化后无交集 → false", () => {
    expect(substringMatch("完全不相关", "mmw攻略组智能体开发者群")).toBe(false);
  });
  it("任一为空 → false", () => {
    expect(substringMatch("", "abc")).toBe(false);
    expect(substringMatch("abc", "")).toBe(false);
    expect(substringMatch("", "")).toBe(false);
  });
});

// ═══════════════════ PR-2：authorize() 成员资格校验 ═══════════════════

describe("authorize() 成员资格校验", () => {
  it("非法 open_id → auth_module_error", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "MMW", "mmw攻略组智能体开发者群"),
    ]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({ openId: "invalid-open-id", chatId: VALID_CHAT_ID_A });
    expect(result.status).toBe("auth_module_error");
  });

  it("非法 chat_id → auth_module_error", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "MMW", "mmw攻略组智能体开发者群"),
    ]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({ openId: VALID_OPEN_ID, chatId: "invalid-chat-id" });
    expect(result.status).toBe("auth_module_error");
    if (result.status === "auth_module_error") {
      expect(result.reason).toMatch(/invalid chat_id format/);
    }
  });

  it("chatId 不在缓存 → no_match", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "MMW", "mmw攻略组智能体开发者群"),
    ]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({ openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID_B });
    expect(result.status).toBe("no_match");
  });

  it("openId 不在群成员列表 → not_member", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "MMW", "mmw攻略组智能体开发者群"),
    ]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID_2]); // 不包含 VALID_OPEN_ID
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({ openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID_A });
    expect(result.status).toBe("not_member");
    if (result.status === "not_member") {
      expect(result.groupId).toBe(VALID_CHAT_ID_A);
      expect(result.groupName).toBe("MMW");
    }
  });

  it("matched 路径", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "MMW", "mmw攻略组智能体开发者群"),
    ]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({ openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID_A });
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.groupId).toBe(VALID_CHAT_ID_A);
      expect(result.groupName).toBe("MMW");
    }
  });

  it("成员缓存缺失 → 主动重试拉取", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "MMW", "mmw攻略组智能体开发者群"),
    ]);
    tool.listGroupMembers
      .mockResolvedValueOnce(null) // 冷启动时拉取失败
      .mockResolvedValueOnce([VALID_OPEN_ID]); // 重试成功
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({ openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID_A });
    expect(result.status).toBe("matched");
    expect(tool.listGroupMembers).toHaveBeenCalledTimes(2);
  });

  it("成员缓存缺失且重试失败 → auth_module_error", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "MMW", "mmw攻略组智能体开发者群"),
    ]);
    tool.listGroupMembers.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({ openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID_A });
    expect(result.status).toBe("auth_module_error");
    if (result.status === "auth_module_error") {
      expect(result.reason).toMatch(/members cache missing/);
    }
  });
});

// ═══════════════════ 事件增量更新 ═══════════════════

describe("事件增量更新", () => {
  it("onChatAdded 补 description + members", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([]);
    tool.getGroupInfo.mockResolvedValueOnce(makeGroup(VALID_CHAT_ID_A, "MMW", "mmw攻略组"));
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    await auth.onChatAdded({ chat_id: VALID_CHAT_ID_A } as ChatAddedPayload);
    expect(auth.groupCount()).toBe(1);
  });

  it("onChatAdded: getGroupInfo 失败 → 仍记录（description 空）", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([]);
    tool.getGroupInfo.mockResolvedValueOnce(null);
    tool.listGroupMembers.mockResolvedValueOnce([]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    await auth.onChatAdded({ chat_id: VALID_CHAT_ID_A } as ChatAddedPayload);
    expect(auth.groupCount()).toBe(1);
  });

  it("onChatDeleted 清空缓存", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "MMW", "x")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    expect(auth.groupCount()).toBe(1);
    auth.onChatDeleted(VALID_CHAT_ID_A);
    expect(auth.groupCount()).toBe(0);
  });

  it("onUserAdded / onUserDeleted 增量更新成员", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "MMW", "x")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    auth.onUserAdded({ chat_id: VALID_CHAT_ID_A, user_id_list: [{ open_id: VALID_OPEN_ID_2 }] } as UserMembershipPayload);
    let r = await auth.authorize({ openId: VALID_OPEN_ID_2, chatId: VALID_CHAT_ID_A });
    expect(r.status).toBe("matched");

    auth.onUserDeleted({ chat_id: VALID_CHAT_ID_A, user_id_list: [{ open_id: VALID_OPEN_ID_2 }] } as UserMembershipPayload);
    r = await auth.authorize({ openId: VALID_OPEN_ID_2, chatId: VALID_CHAT_ID_A });
    expect(r.status).toBe("not_member");
  });

  it("onChatUpdated 更新 description", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "MMW", "原描述")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    auth.onChatUpdated({
      chat_id: VALID_CHAT_ID_A,
      after_change: { description: "新描述" },
    } as ChatUpdatedPayload);
    let r = await auth.authorize({ openId: VALID_OPEN_ID, chatId: VALID_CHAT_ID_A });
    expect(r.status).toBe("matched");

    // 注：PR-2 改造后 authorize 不再依赖 description，但 description 仍保留在 GroupInfo
  });

  it("onChatDisbanded 走 onChatDeleted", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "MMW", "x")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    auth.onChatDisbanded(VALID_CHAT_ID_A);
    expect(auth.groupCount()).toBe(0);
  });
});
