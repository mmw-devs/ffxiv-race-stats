// business/auth.test.ts — AuthModule 模块单元测试
// 覆盖：open_id 格式校验、精确匹配、成员资格验证、4 种 status 分流
//
// 注：GroupTool 通过 vi.fn() mock，不真正调用 lark-cli
import { describe, expect, it, vi } from "vitest";

import type { GroupTool } from "../../broadcast/group-tool.js";
import { createAuthModule, type AuthModule } from "../../business/auth.js";

// ══════════════════════════════════════════════════════════════
// 测试基础设施
// ══════════════════════════════════════════════════════════════

const VALID_OPEN_ID = "ou_1234567890abcdef1234567890abcdef";
const VALID_CHAT_ID_A = "oc_aaaaaaaa0000000000000000000aaaaa";
const VALID_CHAT_ID_B = "oc_bbbbbbbb0000000000000000000bbbbb";

function makeMockGroupTool(): GroupTool & {
  getGroupInfo: ReturnType<typeof vi.fn>;
  listGroupMembers: ReturnType<typeof vi.fn>;
} {
  return {
    getGroupInfo: vi.fn(),
    listGroupMembers: vi.fn(),
    sendGroupMessage: vi.fn(),
    clearCache: vi.fn(),
    cacheSize: vi.fn(),
  } as unknown as GroupTool & {
    getGroupInfo: ReturnType<typeof vi.fn>;
    listGroupMembers: ReturnType<typeof vi.fn>;
  };
}

function makeAuth(tool: GroupTool): AuthModule {
  return createAuthModule({ groupTool: tool, log: () => {} });
}

// ══════════════════════════════════════════════════════════════
// openId 格式校验
// ══════════════════════════════════════════════════════════════

describe("openId 格式校验", () => {
  it("非法 open_id → auth_module_error", async () => {
    const tool = makeMockGroupTool();
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: "invalid-open-id",
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A],
    });
    expect(result.status).toBe("auth_module_error");
    expect(tool.getGroupInfo).not.toHaveBeenCalled();
  });

  it("空字符串 → auth_module_error", async () => {
    const tool = makeMockGroupTool();
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: "",
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A],
    });
    expect(result.status).toBe("auth_module_error");
  });
});

// ══════════════════════════════════════════════════════════════
// 精确匹配 — matched
// ══════════════════════════════════════════════════════════════

describe("精确匹配成功 → matched", () => {
  it("业务描述与群组 description 精确匹配 + 用户在成员列表", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo.mockResolvedValueOnce({
      chatId: VALID_CHAT_ID_A,
      name: "运营组",
      description: "赛事运营",
    });
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A],
    });
    expect(result).toEqual({
      status: "matched",
      groupId: VALID_CHAT_ID_A,
      groupName: "运营组",
      description: "赛事运营",
    });
  });

  it("业务描述首尾空白不影响匹配（trim 后精确匹配）", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo.mockResolvedValueOnce({
      chatId: VALID_CHAT_ID_A,
      name: "运营组",
      description: "赛事运营",
    });
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "  赛事运营  ",
      authorizedGroupIds: [VALID_CHAT_ID_A],
    });
    expect(result.status).toBe("matched");
  });
});

// ══════════════════════════════════════════════════════════════
// 精确匹配 — not_member / no_match
// ══════════════════════════════════════════════════════════════

describe("匹配 description 但用户不在成员列表 → not_member", () => {
  it("返回 not_member + 群组信息", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo.mockResolvedValueOnce({
      chatId: VALID_CHAT_ID_A,
      name: "运营组",
      description: "赛事运营",
    });
    tool.listGroupMembers.mockResolvedValueOnce(["ou_other_user_open_id_xxxxxxxxxxxxxxxx"]);
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A],
    });
    expect(result).toEqual({
      status: "not_member",
      groupId: VALID_CHAT_ID_A,
      groupName: "运营组",
    });
  });
});

describe("无群组匹配 → no_match", () => {
  it("所有群组 description 都不匹配", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo
      .mockResolvedValueOnce({ chatId: VALID_CHAT_ID_A, name: "A 组", description: "A 描述" })
      .mockResolvedValueOnce({ chatId: VALID_CHAT_ID_B, name: "B 组", description: "B 描述" });
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "完全不匹配",
      authorizedGroupIds: [VALID_CHAT_ID_A, VALID_CHAT_ID_B],
    });
    expect(result.status).toBe("no_match");
  });
});

// ══════════════════════════════════════════════════════════════
// 候选群组遍历
// ══════════════════════════════════════════════════════════════

describe("候选群组遍历", () => {
  it("遍历多群组直到找到匹配项", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo
      .mockResolvedValueOnce({ chatId: VALID_CHAT_ID_A, name: "A 组", description: "A 描述" })
      .mockResolvedValueOnce({ chatId: VALID_CHAT_ID_B, name: "B 组", description: "赛事运营" });
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A, VALID_CHAT_ID_B],
    });
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.groupId).toBe(VALID_CHAT_ID_B);
    }
    expect(tool.getGroupInfo).toHaveBeenCalledTimes(2);
  });

  it("单个群组 getGroupInfo 失败 → 跳过继续遍历", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo
      .mockResolvedValueOnce(null) // A 群失败
      .mockResolvedValueOnce({ chatId: VALID_CHAT_ID_B, name: "B 组", description: "赛事运营" });
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A, VALID_CHAT_ID_B],
    });
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.groupId).toBe(VALID_CHAT_ID_B);
    }
  });

  it("匹配成功后 listGroupMembers 失败 → 跳过继续遍历", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo
      .mockResolvedValueOnce({ chatId: VALID_CHAT_ID_A, name: "A 组", description: "赛事运营" })
      .mockResolvedValueOnce({ chatId: VALID_CHAT_ID_B, name: "B 组", description: "赛事运营" });
    tool.listGroupMembers
      .mockResolvedValueOnce(null) // A 群成员列表拉失败
      .mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A, VALID_CHAT_ID_B],
    });
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.groupId).toBe(VALID_CHAT_ID_B);
    }
  });

  it("空 authorizedGroupIds 数组 → no_match", async () => {
    const tool = makeMockGroupTool();
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
      authorizedGroupIds: [],
    });
    expect(result.status).toBe("no_match");
    expect(tool.getGroupInfo).not.toHaveBeenCalled();
  });

  it("所有群组 getGroupInfo 都失败 → auth_module_error", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo.mockResolvedValue(null);
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A, VALID_CHAT_ID_B],
    });
    expect(result.status).toBe("auth_module_error");
  });
});

// ══════════════════════════════════════════════════════════════
// 边界情况
// ══════════════════════════════════════════════════════════════

describe("边界情况", () => {
  it("业务描述为空 → no_match（不视为匹配空 description 群组）", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo.mockResolvedValueOnce({
      chatId: VALID_CHAT_ID_A,
      name: "A 组",
      description: "",
    });
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "",
      authorizedGroupIds: [VALID_CHAT_ID_A],
    });
    expect(result.status).toBe("no_match");
    expect(tool.listGroupMembers).not.toHaveBeenCalled();
  });

  it("群组 description 为空 → 不匹配（除非业务描述也为空，但前面已拦）", async () => {
    const tool = makeMockGroupTool();
    tool.getGroupInfo.mockResolvedValueOnce({
      chatId: VALID_CHAT_ID_A,
      name: "A 组",
      description: "",
    });
    const auth = makeAuth(tool);
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
      authorizedGroupIds: [VALID_CHAT_ID_A],
    });
    expect(result.status).toBe("no_match");
  });
});