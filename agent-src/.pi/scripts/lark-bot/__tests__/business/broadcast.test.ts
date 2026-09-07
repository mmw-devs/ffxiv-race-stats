// business/broadcast.test.ts — BroadcastModule 模块单元测试
// 覆盖：固定格式模板渲染（matched / not_member）、announce 调用 groupTool.sendGroupMessage、
// 失败透传、纯函数形态
//
// 注：GroupTool 通过 vi.fn() mock，不真正调用 lark-cli
import { describe, expect, it, vi } from "vitest";

import type { GroupTool } from "../../broadcast/group-tool.js";
import {
  createBroadcastModule,
  renderBroadcastText,
  type BroadcastModule,
} from "../../business/broadcast.js";

// ══════════════════════════════════════════════════════════════
// 测试基础设施
// ══════════════════════════════════════════════════════════════

const VALID_OPEN_ID = "ou_1234567890abcdef1234567890abcdef";
const VALID_CHAT_ID = "oc_aaaaaaaa0000000000000000000aaaaa";

function makeMockGroupTool(): GroupTool & {
  sendGroupMessage: ReturnType<typeof vi.fn>;
} {
  return {
    getGroupInfo: vi.fn(),
    listGroupMembers: vi.fn(),
    sendGroupMessage: vi.fn(),
    clearCache: vi.fn(),
    cacheSize: vi.fn(),
  } as unknown as GroupTool & {
    sendGroupMessage: ReturnType<typeof vi.fn>;
  };
}

function makeBroadcast(tool: GroupTool): BroadcastModule {
  return createBroadcastModule({ groupTool: tool, log: () => {} });
}

// ══════════════════════════════════════════════════════════════
// renderBroadcastText — 模板渲染
// ══════════════════════════════════════════════════════════════

describe("renderBroadcastText — 固定模板渲染", () => {
  it("matched → 成功模板", () => {
    const text = renderBroadcastText({
      openId: VALID_OPEN_ID,
      groupId: VALID_CHAT_ID,
      groupName: "运营组",
      outcome: "matched",
    });
    expect(text).toBe(`[业务私聊申请] ✅ 用户 ${VALID_OPEN_ID} 申请成功（群组：运营组）`);
  });

  it("not_member → 失败模板（默认原因）", () => {
    const text = renderBroadcastText({
      openId: VALID_OPEN_ID,
      groupId: VALID_CHAT_ID,
      groupName: "运营组",
      outcome: "not_member",
    });
    expect(text).toBe(`[业务私聊申请] ❌ 用户 ${VALID_OPEN_ID} 申请失败（群组：运营组）：不在成员列表`);
  });

  it("not_member → 失败模板（自定义原因）", () => {
    const text = renderBroadcastText({
      openId: VALID_OPEN_ID,
      groupId: VALID_CHAT_ID,
      groupName: "运营组",
      outcome: "not_member",
      reason: "用户已离职",
    });
    expect(text).toBe(`[业务私聊申请] ❌ 用户 ${VALID_OPEN_ID} 申请失败（群组：运营组）：用户已离职`);
  });
});

// ══════════════════════════════════════════════════════════════
// announce — 调用 groupTool.sendGroupMessage
// ══════════════════════════════════════════════════════════════

describe("announce — 正常路径", () => {
  it("matched 成功 → groupTool.sendGroupMessage 被调用一次 + ok=true", async () => {
    const tool = makeMockGroupTool();
    tool.sendGroupMessage.mockResolvedValueOnce({ ok: true });
    const bc = makeBroadcast(tool);
    const result = await bc.announce({
      openId: VALID_OPEN_ID,
      groupId: VALID_CHAT_ID,
      groupName: "运营组",
      outcome: "matched",
    });
    expect(result.ok).toBe(true);
    expect(tool.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(tool.sendGroupMessage).toHaveBeenCalledWith(
      VALID_CHAT_ID,
      `[业务私聊申请] ✅ 用户 ${VALID_OPEN_ID} 申请成功（群组：运营组）`,
    );
  });

  it("not_member 失败 → 调用 sendGroupMessage + ok=true（sendGroupMessage 成功）", async () => {
    const tool = makeMockGroupTool();
    tool.sendGroupMessage.mockResolvedValueOnce({ ok: true });
    const bc = makeBroadcast(tool);
    const result = await bc.announce({
      openId: VALID_OPEN_ID,
      groupId: VALID_CHAT_ID,
      groupName: "运营组",
      outcome: "not_member",
    });
    expect(result.ok).toBe(true);
    expect(tool.sendGroupMessage).toHaveBeenCalledTimes(1);
  });
});

describe("announce — 失败路径（groupTool.sendGroupMessage 失败透传）", () => {
  it("sendGroupMessage 返回 ok=false → 透传 error", async () => {
    const tool = makeMockGroupTool();
    tool.sendGroupMessage.mockResolvedValueOnce({ ok: false, error: "send failed" });
    const bc = makeBroadcast(tool);
    const result = await bc.announce({
      openId: VALID_OPEN_ID,
      groupId: VALID_CHAT_ID,
      groupName: "运营组",
      outcome: "matched",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("send failed");
  });
});

// ══════════════════════════════════════════════════════════════
// 纯函数形态（业务层文档 §4）
// ══════════════════════════════════════════════════════════════

describe("纯函数形态约束", () => {
  it("不调 groupTool.getGroupInfo（避免冗余 description 查询）", async () => {
    const tool = makeMockGroupTool();
    tool.sendGroupMessage.mockResolvedValueOnce({ ok: true });
    const bc = makeBroadcast(tool);
    await bc.announce({
      openId: VALID_OPEN_ID,
      groupId: VALID_CHAT_ID,
      groupName: "运营组",
      outcome: "matched",
    });
    expect(tool.getGroupInfo).not.toHaveBeenCalled();
  });

  it("不调 groupTool.listGroupMembers（鉴权模块的事）", async () => {
    const tool = makeMockGroupTool();
    tool.sendGroupMessage.mockResolvedValueOnce({ ok: true });
    const bc = makeBroadcast(tool);
    await bc.announce({
      openId: VALID_OPEN_ID,
      groupId: VALID_CHAT_ID,
      groupName: "运营组",
      outcome: "matched",
    });
    expect(tool.listGroupMembers).not.toHaveBeenCalled();
  });
});