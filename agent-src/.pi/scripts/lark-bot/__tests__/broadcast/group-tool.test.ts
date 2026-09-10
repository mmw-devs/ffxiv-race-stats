// broadcast/group-tool.test.ts — GroupTool 模块单元测试
// 覆盖：chat_id 格式校验、缓存、fail-closed（API 失败 / JSON 解析失败 / 缺字段）
//
// 注：lark-cli 调用部分通过 vi.mock("node:child_process") 拦截 execFileSync
// 单元测试不真正调用 lark-cli，避免依赖飞书环境
import { execFileSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGroupTool, type GroupTool } from "../../broadcast/group-tool.js";

// ══════════════════════════════════════════════════════════════
// 测试基础设施
// ══════════════════════════════════════════════════════════════

const CLI_PATH = "/tmp/test-cli";

// mock execFileSync — 不真正调用 lark-cli
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

const mockedExecFileSync = vi.mocked(execFileSync);

function makeTool(): GroupTool {
  return createGroupTool({
    cliPath: CLI_PATH,
    log: () => {}, // 静音测试日志
  });
}

const VALID_CHAT_ID = "oc_abcdef0123456789abcdef0123456789";
const VALID_USER_OPEN_ID = "ou_1234567890abcdef1234567890abcdef";

beforeEach(() => {
  mockedExecFileSync.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════
// chat_id 格式校验
// ══════════════════════════════════════════════════════════════

describe("chat_id 格式校验（getGroupInfo）", () => {
  it("非法 chat_id → 返回 null，不调 lark-cli", async () => {
    const tool = makeTool();
    const result = await tool.getGroupInfo("invalid-chat-id");
    expect(result).toBeNull();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("空字符串 → 返回 null", async () => {
    const tool = makeTool();
    const result = await tool.getGroupInfo("");
    expect(result).toBeNull();
  });
});

describe("chat_id 格式校验（listGroupMembers）", () => {
  it("非法 chat_id → 返回 null，不调 lark-cli", async () => {
    const tool = makeTool();
    const result = await tool.listGroupMembers("invalid-chat-id");
    expect(result).toBeNull();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});

describe("chat_id 格式校验（sendGroupMessage）", () => {
  it("非法 chat_id → 返回 ok=false，不调 lark-cli", async () => {
    const tool = makeTool();
    const result = await tool.sendGroupMessage("invalid-chat-id", { text: "hi" });
    expect(result.ok).toBe(false);
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════
// getGroupInfo — lark-cli 响应解析
// ══════════════════════════════════════════════════════════════

describe("getGroupInfo — 正常路径", () => {
  it("返回 name + description", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({
        data: { name: "运营组", description: "赛事运营" },
      }),
    );
    const tool = makeTool();
    const info = await tool.getGroupInfo(VALID_CHAT_ID);
    expect(info).toEqual({
      chatId: VALID_CHAT_ID,
      name: "运营组",
      description: "赛事运营",
    });
  });

  it("description 缺失时用空字符串兜底", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({
        data: { name: "运营组" },
      }),
    );
    const tool = makeTool();
    const info = await tool.getGroupInfo(VALID_CHAT_ID);
    expect(info?.description).toBe("");
  });
});

describe("getGroupInfo — fail-closed", () => {
  it("lark-cli 抛错 → 返回 null", async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const tool = makeTool();
    const info = await tool.getGroupInfo(VALID_CHAT_ID);
    expect(info).toBeNull();
  });

  it("响应 JSON 解析失败 → 返回 null", async () => {
    mockedExecFileSync.mockReturnValueOnce("not json");
    const tool = makeTool();
    const info = await tool.getGroupInfo(VALID_CHAT_ID);
    expect(info).toBeNull();
  });

  it("响应缺 name → 返回 null", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { description: "x" } }),
    );
    const tool = makeTool();
    const info = await tool.getGroupInfo(VALID_CHAT_ID);
    expect(info).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// listGroupMembers — 解析与过滤
// ══════════════════════════════════════════════════════════════

describe("listGroupMembers — 正常路径", () => {
  it("返回 user 成员的 open_id 列表（users + bots 字段）", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          users: [
            { member_id: VALID_USER_OPEN_ID },
            { member_id: "ou_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          ],
          bots: [{ member_id: "cli_xxx" }], // bots 不应出现在返回结果中
        },
      }),
    );
    const tool = makeTool();
    const members = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(members).toEqual([VALID_USER_OPEN_ID, "ou_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
  });

  it("空成员列表 → 返回 []", async () => {
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify({ data: { users: [] } }));
    const tool = makeTool();
    const members = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(members).toEqual([]);
  });

  it("stdout 含 lark-cli 进度行（[page 1] fetching... / Found N user(s)）→ 仍正确解析", async () => {
    const pollutedStdout =
      "[page 1] fetching...\nFound 6 user(s) and 1 bot(s)\n" +
      JSON.stringify({
        data: {
          users: [{ member_id: VALID_USER_OPEN_ID }],
          bots: [{ member_id: "cli_xxx" }],
        },
      });
    mockedExecFileSync.mockReturnValueOnce(pollutedStdout);
    const tool = makeTool();
    const members = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(members).toEqual([VALID_USER_OPEN_ID]);
  });
});

describe("listGroupMembers — fail-closed", () => {
  it("lark-cli 抛错 → 返回 null", async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("timeout");
    });
    const tool = makeTool();
    const members = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(members).toBeNull();
  });

  it("响应缺 items → 返回 null", async () => {
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify({ data: {} }));
    const tool = makeTool();
    const members = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(members).toBeNull();
  });

  it("响应 JSON 解析失败 → 返回 null", async () => {
    mockedExecFileSync.mockReturnValueOnce("garbage");
    const tool = makeTool();
    const members = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(members).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// sendGroupMessage — 发送成功 / 失败
// ══════════════════════════════════════════════════════════════

describe("sendGroupMessage — 正常路径", () => {
  it("返回 message_id → ok=true", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { message_id: "om_1234567890abcdef" } }),
    );
    const tool = makeTool();
    const result = await tool.sendGroupMessage(VALID_CHAT_ID, { text: "hello" });
    expect(result.ok).toBe(true);
  });
});

describe("sendGroupMessage — 失败路径", () => {
  it("lark-cli 抛错 → ok=false + error", async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("network error");
    });
    const tool = makeTool();
    const result = await tool.sendGroupMessage(VALID_CHAT_ID, { text: "hello" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("响应缺 message_id → ok=false", async () => {
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify({ data: {} }));
    const tool = makeTool();
    const result = await tool.sendGroupMessage(VALID_CHAT_ID, { text: "hello" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no message_id in response");
  });

  it("响应 JSON 解析失败 → ok=false", async () => {
    mockedExecFileSync.mockReturnValueOnce("not json");
    const tool = makeTool();
    const result = await tool.sendGroupMessage(VALID_CHAT_ID, { text: "hello" });
    expect(result.ok).toBe(false);
  });
});


// ══════════════════════════════════════════════════════════════
// PR#163 边界测试（issue#168 第三阶段）
//
// 溯源机制：每条测试顶部注明 PR#163 bug 来源、触发场景、当前行为。
// 测试反映"当前代码实际行为"（A 哲学）——即使有 bug 也如实记录。
// 未来修复 bug 时改测试即可（增量变更）。
// ══════════════════════════════════════════════════════════════

/**
 * PR#163 边界测试 #1：listGroupMembers 响应 `data.items` 字段（旧 lark-cli 版本）
 *
 * 来源: PR#163 bug `data.items` vs `data.users+bots` 字段差异
 * 触发场景: lark-cli 旧版本返回 `{"data": {"items": [...]}}` 而非 `{"data": {"users": [...]}}`
 * 当前行为: 当前代码只读 `data.users`；旧版本响应会因 `data.users` 不存在而返回 null
 *   （或解析失败）。测试如实记录此行为。
 *   如未来 lark-cli 版本兼容需支持 `data.items`，可在本测试新增 `data.items` 断言。
 */
describe("PR#163 #1 listGroupMembers — data.items 旧字段（当前不支持）", () => {
  it("响应含 data.items（无 data.users）→ 返回 null（当前行为）", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { items: [{ member_id: VALID_USER_OPEN_ID }] } }),
    );
    const tool = makeTool();
    const result = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(result).toBeNull();
  });
});

/**
 * PR#163 边界测试 #2：listGroupMembers 响应 `data.users + data.bots` 双字段
 *
 * 来源: PR#163 bug `data.items` vs `data.users+bots` 字段差异
 * 触发场景: lark-cli 返回 `{"data": {"users": [...], "bots": [...]}}`
 * 当前行为: 当前代码只读 `data.users`；bots 字段被忽略。测试记录此行为。
 *   如未来需同时支持 users + bots，在本测试新增 bots 断言。
 */
describe("PR#163 #2 listGroupMembers — data.users + data.bots 双字段（当前忽略 bots）", () => {
  it("响应含 users + bots → 只返回 users 的 member_id（bots 被忽略）", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          users: [{ member_id: VALID_USER_OPEN_ID }],
          bots: [{ member_id: "ou_bot_xxx" }],
        },
      }),
    );
    const tool = makeTool();
    const result = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(result).toEqual([VALID_USER_OPEN_ID]);
  });
});

/**
 * PR#163 边界测试 #3：sendGroupMessage 无 replyToMessageId → 走 +messages-send
 *
 * 来源: PR#163 bug `+messages-reply` 与 `+messages-send` 参数差异
 * 触发场景: 群发消息（不引用回复）—— 调用 `im +messages-send --chat-id <chatId>`
 * 当前行为: 参数构造正确（包含 --chat-id，不含 --message-id）。
 */
describe("PR#163 #3 sendGroupMessage — 无 replyTo（走 +messages-send + --chat-id）", () => {
  it("构造参数包含 --chat-id，不含 --message-id", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { message_id: "om_outgoing" } }),
    );
    const tool = makeTool();
    await tool.sendGroupMessage(VALID_CHAT_ID, { text: "hello" });
    const callArgs = mockedExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("+messages-send");
    expect(callArgs).toContain("--chat-id");
    expect(callArgs).toContain(VALID_CHAT_ID);
    expect(callArgs).not.toContain("--message-id");
  });
});

/**
 * PR#163 边界测试 #4：sendGroupMessage 有 replyToMessageId → 走 +messages-reply
 *
 * 来源: PR#163 bug `+messages-reply` 与 `+messages-send` 参数差异
 * 触发场景: 群消息引用回复 —— 调用 `im +messages-reply --message-id <replyTo>`
 *   （无需 --chat-id，lark-cli 通过 message-id 自动定位父消息）
 * 当前行为: 参数构造正确（包含 --message-id，不含 --chat-id）。
 */
describe("PR#163 #4 sendGroupMessage — 有 replyTo（走 +messages-reply + --message-id）", () => {
  it("构造参数包含 --message-id，不含 --chat-id", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { message_id: "om_outgoing_reply" } }),
    );
    const tool = makeTool();
    await tool.sendGroupMessage(VALID_CHAT_ID, {
      text: "reply",
      replyToMessageId: "om_parent",
    });
    const callArgs = mockedExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("+messages-reply");
    expect(callArgs).toContain("--message-id");
    expect(callArgs).toContain("om_parent");
    expect(callArgs).not.toContain("--chat-id");
  });
});

/**
 * PR#163 边界测试 #5：sendGroupMessage chat_id 非法 → fail-closed
 *
 * 来源: 防御性 fail-closed 设计（PR#163 上下文）
 * 触发场景: chat_id 不符合 `oc_<32 hex>` 格式
 * 当前行为: 返回 `{ok: false, error: 'invalid chat_id'}`，不调 lark-cli。
 */
describe("PR#163 #5 sendGroupMessage — chat_id 非法格式（fail-closed）", () => {
  it("返回 ok=false + error，不调 execFileSync", async () => {
    const tool = makeTool();
    const result = await tool.sendGroupMessage("invalid-chat-id", { text: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid chat_id");
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});

// 缓存：groupTool 不再缓存任何群组/成员数据（事件驱动版）。
// 群组/成员实时性由 AuthModule 内部 Map + 飞书事件维护。
// 调用 groupTool.getGroupInfo / listGroupMembers 每次都实时调 lark-cli（无缓存语义）。
// ══════════════════════════════════════════════════════════════
// PR#163 边界测试 #2（续） — listGroupMembers / listAllBotGroups JSON 行污染
// ══════════════════════════════════════════════════════════════

/**
 * PR#163 边界测试 #9：listGroupMembers 处理 stdout JSON 行污染（回归测试）
 *
 * 来源: PR#163 bug #2 "JSON 行污染"
 * 当前行为: listGroupMembers 用 `out.indexOf("{")` 找到 JSON 起点，跳过非 JSON 前缀（line 134-138）。
 *   这是修复后的回归测试——确保未来重构不会引入此 bug。
 */
describe("PR#163 #9 listGroupMembers — stdout JSON 行污染（已修复，回归）", () => {
  it("stdout 含 lark-cli 提示行 + JSON → 正确解析 members", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      "[page 1] fetching...\nFound 6 user(s) and 1 bot(s)\n" +
        JSON.stringify({
          data: { users: [{ member_id: VALID_USER_OPEN_ID }] },
        }),
    );
    const tool = makeTool();
    const result = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(result).toEqual([VALID_USER_OPEN_ID]);
  });
});

/**
 * PR#163 边界测试 #10：listAllBotGroups 处理 stdout JSON 行污染（回归测试）
 *
 * 来源: PR#163 bug #2 "JSON 行污染"
 * 当前行为: listAllBotGroups 当前用 `JSON.parse(out)` 整体解析（line 230+）。
 *   测试反映当前行为——若 stdout 含非 JSON 前缀，parse 失败 → 返回 null。
 *   如未来修复（参考 listGroupMembers 的 indexOf 处理），改为断言成功。
 */
describe("PR#163 #10 listAllBotGroups — stdout JSON 行污染（当前解析失败）", () => {
  it("stdout 含非 JSON 前缀 + JSON → 当前返回 null（与 listGroupMembers 行为不同）", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      "Loading chat list...\n" +
        JSON.stringify({
          data: { chats: [{ chat_id: VALID_CHAT_ID, name: "Test Group", description: "x" }] },
        }),
    );
    const tool = makeTool();
    const result = await tool.listAllBotGroups();
    // 当前行为：JSON.parse 整体失败，返回 null
    expect(result).toBeNull();
    // 注：listGroupMembers 已用 indexOf 处理；listAllBotGroups 未处理（行为不一致）
  });
});
