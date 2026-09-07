// business/auth.test.ts — AuthModule 模块单元测试（事件驱动版）
// 覆盖：openId 校验、归一化子串匹配、内存缓存、事件增量更新、agentMatcher 钩子降级
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

function makeAuth(tool: GroupTool, opts?: { agentMatcher?: any }): AuthModule {
  return createAuthModule({ groupTool: tool, log: () => {}, ...opts });
}

function makeGroup(chatId: string, name: string, description: string): GroupInfo {
  return { chatId, name, description };
}

// ═══════════════════ 归一化工具函数 ═══════════════════

describe("normalizeForMatch", () => {
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

describe("substringMatch", () => {
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

// ═══════════════════ openId 格式校验 ═══════════════════

describe("openId 格式校验", () => {
  it("非法 open_id → auth_module_error", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({
      openId: "invalid-open-id",
      businessDescription: "赛事运营",
    });
    expect(result.status).toBe("auth_module_error");
  });

  it("空字符串 → auth_module_error", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    const result = await auth.authorize({ openId: "", businessDescription: "" });
    expect(result.status).toBe("auth_module_error");
  });
});

// ═══════════════════ 初始化 ═══════════════════

describe("initBoot", () => {
  it("成功冷启动 → 群组缓存填充", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "A 组", "赛事运营"),
      makeGroup(VALID_CHAT_ID_B, "B 组", ""),  // 空 description
    ]);
    tool.listGroupMembers
      .mockResolvedValueOnce([VALID_OPEN_ID])
      .mockResolvedValueOnce([VALID_OPEN_ID_2]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    expect(auth.groupCount()).toBe(2);
    expect(tool.listGroupMembers).toHaveBeenCalledTimes(2);
  });

  it("listAllBotGroups 失败 → 抛错（fail-fast）", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce(null);
    const auth = makeAuth(tool);
    await expect(auth.initBoot()).rejects.toThrow();
  });

  it("listGroupMembers 失败 → 跳过该群成员缓存，继续", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "赛事运营")]);
    tool.listGroupMembers.mockResolvedValueOnce(null);
    const auth = makeAuth(tool);
    await auth.initBoot();
    expect(auth.groupCount()).toBe(1);
  });
});

// ═══════════════════ 归一化子串匹配 — matched ═══════════════════

describe("归一化子串匹配 → matched", () => {
  it("用户描述 = 群组描述", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "运营组", "mmw攻略组智能体开发者群")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "mmw攻略组智能体开发者群",
    });
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.groupId).toBe(VALID_CHAT_ID_A);
      expect(result.groupName).toBe("运营组");
    }
  });

  it("用户描述是群组描述的子串", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "运营组", "mmw攻略组智能体开发者群")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "mmw攻略",
    });
    expect(result.status).toBe("matched");
  });

  it("归一化后子串匹配（用户描述加全角空格）", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "运营组", "mmw攻略组智能体开发者群")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "  ＭＭＷ攻略  ",
    });
    expect(result.status).toBe("matched");
  });

  it("归一化后子串匹配（用户描述加标点）", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "运营组", "mmw攻略组智能体开发者群")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "ＭＭＷ攻略，组！",
    });
    expect(result.status).toBe("matched");
  });
});

// ═══════════════════ matched → not_member / no_match ═══════════════════

describe("matched desc 但用户不在成员列表 → not_member", () => {
  it("返回 not_member + 群组信息", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "运营组", "赛事运营")]);
    tool.listGroupMembers.mockResolvedValueOnce(["ou_other_user_open_id_xxxxxxxxxxxxxxxx"]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "赛事运营",
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
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "A", "A 描述"),
      makeGroup(VALID_CHAT_ID_B, "B", "B 描述"),
    ]);
    tool.listGroupMembers.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "完全不匹配",
    });
    expect(result.status).toBe("no_match");
  });

  it("所有群组 description 都为空 → no_match", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([
      makeGroup(VALID_CHAT_ID_A, "A", ""),
      makeGroup(VALID_CHAT_ID_B, "B", ""),
    ]);
    tool.listGroupMembers.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "任意描述",
    });
    expect(result.status).toBe("no_match");
  });
});

// ═══════════════════ 事件处理：增量更新内存 ═══════════════════

describe("事件处理：bot 加入群", () => {
  it("onChatAdded → 调 +chat-get 补 description + +chat-members-list 补成员", async () => {
    const tool = makeMockGroupTool();
    // initBoot 返回空（初始无群组）
    tool.listAllBotGroups.mockResolvedValueOnce([]);
    // onChatAdded 触发的 +chat-get
    tool.getGroupInfo.mockResolvedValueOnce(makeGroup(VALID_CHAT_ID_A, "新群", "新群描述"));
    // onChatAdded 触发的 +chat-members-list
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const payload: ChatAddedPayload = { chat_id: VALID_CHAT_ID_A, name: "新群" };
    await auth.onChatAdded(payload);

    expect(auth.groupCount()).toBe(1);
    // 现在可以用 authorize 匹配
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "新群描述",
    });
    expect(result.status).toBe("matched");
  });

  it("onChatAdded：+chat-get 失败 → 仅记录空 description", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([]);
    tool.getGroupInfo.mockResolvedValueOnce(null);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const payload: ChatAddedPayload = { chat_id: VALID_CHAT_ID_A, name: "新群" };
    await auth.onChatAdded(payload);

    // 空 description → 跳过 → no_match
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "任意描述",
    });
    expect(result.status).toBe("no_match");
  });
});

describe("事件处理：bot 离开群 / 群解散", () => {
  it("onChatDeleted → 删除群组 + 成员缓存", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "A 描述")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();
    expect(auth.groupCount()).toBe(1);

    auth.onChatDeleted(VALID_CHAT_ID_A);
    expect(auth.groupCount()).toBe(0);
  });

  it("onChatDisbanded → 等同 onChatDeleted", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "A 描述")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    auth.onChatDisbanded(VALID_CHAT_ID_A);
    expect(auth.groupCount()).toBe(0);
  });
});

describe("事件处理：用户加入/离开群", () => {
  it("onUserAdded → 内存加入成员", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "A 描述")]);
    tool.listGroupMembers.mockResolvedValueOnce([]); // 初始无成员
    const auth = makeAuth(tool);
    await auth.initBoot();

    // 之前鉴权 → not_member（用户不在）
    let result = await auth.authorize({ openId: VALID_OPEN_ID, businessDescription: "A 描述" });
    expect(result.status).toBe("not_member");

    // 事件推送：用户加入群
    auth.onUserAdded({
      chat_id: VALID_CHAT_ID_A,
      user_id_list: [{ open_id: VALID_OPEN_ID }],
    } as UserMembershipPayload);

    // 再次鉴权 → matched
    result = await auth.authorize({ openId: VALID_OPEN_ID, businessDescription: "A 描述" });
    expect(result.status).toBe("matched");
  });

  it("onUserDeleted → 内存删除成员", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "A 描述")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    let result = await auth.authorize({ openId: VALID_OPEN_ID, businessDescription: "A 描述" });
    expect(result.status).toBe("matched");

    auth.onUserDeleted({
      chat_id: VALID_CHAT_ID_A,
      user_id_list: [{ open_id: VALID_OPEN_ID }],
    } as UserMembershipPayload);

    result = await auth.authorize({ openId: VALID_OPEN_ID, businessDescription: "A 描述" });
    expect(result.status).toBe("not_member");
  });
});

describe("事件处理：群信息更新（description 变更）", () => {
  it("onChatUpdated payload 含 description → 内存更新", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "旧描述")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    auth.onChatUpdated({
      chat_id: VALID_CHAT_ID_A,
      after_change: { name: "A", description: "新描述" },
    } as ChatUpdatedPayload);

    // 现在用新描述能匹配
    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "新描述",
    });
    expect(result.status).toBe("matched");
  });

  it("onChatUpdated：chat_id 不在缓存 → 忽略", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    auth.onChatUpdated({
      chat_id: VALID_CHAT_ID_A,
      after_change: { description: "新描述" },
    } as ChatUpdatedPayload);

    expect(auth.groupCount()).toBe(0);
  });
});

// ═══════════════════ agentMatcher 钩子（方案 D） ═══════════════════

describe("agentMatcher 钩子（方案 D）", () => {
  it("agentMatcher 返回 chat_id → matched", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "智能体开发")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const agentMatcher = vi.fn().mockResolvedValue(VALID_CHAT_ID_A);
    const auth = makeAuth(tool, { agentMatcher });
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "我们的开发群",
    });
    expect(result.status).toBe("matched");
    expect(agentMatcher).toHaveBeenCalledTimes(1);
    expect(agentMatcher).toHaveBeenCalledWith("我们的开发群", expect.any(Array));
  });

  it("agentMatcher 返回 null → 降级到子串匹配", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "智能体开发")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const agentMatcher = vi.fn().mockResolvedValue(null);
    const auth = makeAuth(tool, { agentMatcher });
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "智能体开发",
    });
    expect(result.status).toBe("matched");
    expect(agentMatcher).toHaveBeenCalled();
  });

  it("agentMatcher 抛异常 → 降级到子串匹配", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "智能体开发")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const agentMatcher = vi.fn().mockRejectedValue(new Error("PI Agent timeout"));
    const auth = makeAuth(tool, { agentMatcher });
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "智能体开发",
    });
    expect(result.status).toBe("matched");
  });

  it("agentMatcher 返回不存在的 chat_id → 降级到子串匹配", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "智能体开发")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const agentMatcher = vi.fn().mockResolvedValue("oc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    const auth = makeAuth(tool, { agentMatcher });
    await auth.initBoot();

    const result = await auth.authorize({
      openId: VALID_OPEN_ID,
      businessDescription: "智能体开发",
    });
    expect(result.status).toBe("matched");  // 降级成功
  });
});

// ═══════════════════ 边界 ═══════════════════

describe("边界", () => {
  it("业务描述为空 → no_match", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "A 描述")]);
    tool.listGroupMembers.mockResolvedValueOnce([VALID_OPEN_ID]);
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({ openId: VALID_OPEN_ID, businessDescription: "" });
    expect(result.status).toBe("no_match");
  });

  it("成员缓存缺失（事件尚未推送）→ auth_module_error", async () => {
    const tool = makeMockGroupTool();
    tool.listAllBotGroups.mockResolvedValueOnce([makeGroup(VALID_CHAT_ID_A, "A", "A 描述")]);
    tool.listGroupMembers.mockResolvedValueOnce(null);  // 冷启动时失败，成员缓存缺失
    const auth = makeAuth(tool);
    await auth.initBoot();

    const result = await auth.authorize({ openId: VALID_OPEN_ID, businessDescription: "A 描述" });
    expect(result.status).toBe("auth_module_error");
  });
});