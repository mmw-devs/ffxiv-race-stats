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

// 缓存：groupTool 不再缓存任何群组/成员数据（事件驱动版）。
// 群组/成员实时性由 AuthModule 内部 Map + 飞书事件维护。
// 调用 groupTool.getGroupInfo / listGroupMembers 每次都实时调 lark-cli（无缓存语义）。