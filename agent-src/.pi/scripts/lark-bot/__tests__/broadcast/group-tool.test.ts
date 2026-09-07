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
    const result = await tool.sendGroupMessage("invalid-chat-id", "hi");
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
  it("返回 user 类型成员的 open_id 列表", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({
        data: {
          items: [
            { member_id: VALID_USER_OPEN_ID, type: "user" },
            { member_id: "ou_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", type: "user" },
            { member_id: "cli_xxx", type: "bot" }, // 应被过滤
          ],
        },
      }),
    );
    const tool = makeTool();
    const members = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(members).toEqual([VALID_USER_OPEN_ID, "ou_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
  });

  it("空成员列表 → 返回 []", async () => {
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify({ data: { items: [] } }));
    const tool = makeTool();
    const members = await tool.listGroupMembers(VALID_CHAT_ID);
    expect(members).toEqual([]);
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
    const result = await tool.sendGroupMessage(VALID_CHAT_ID, "hello");
    expect(result.ok).toBe(true);
  });
});

describe("sendGroupMessage — 失败路径", () => {
  it("lark-cli 抛错 → ok=false + error", async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("network error");
    });
    const tool = makeTool();
    const result = await tool.sendGroupMessage(VALID_CHAT_ID, "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("响应缺 message_id → ok=false", async () => {
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify({ data: {} }));
    const tool = makeTool();
    const result = await tool.sendGroupMessage(VALID_CHAT_ID, "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no message_id in response");
  });

  it("响应 JSON 解析失败 → ok=false", async () => {
    mockedExecFileSync.mockReturnValueOnce("not json");
    const tool = makeTool();
    const result = await tool.sendGroupMessage(VALID_CHAT_ID, "hello");
    expect(result.ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// 缓存：成功 1h / 失败 30s
// ══════════════════════════════════════════════════════════════

describe("缓存 — getGroupInfo", () => {
  it("成功响应被缓存（第二次不调 lark-cli）", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { name: "运营组", description: "x" } }),
    );
    const tool = makeTool();
    await tool.getGroupInfo(VALID_CHAT_ID);
    await tool.getGroupInfo(VALID_CHAT_ID); // 第二次
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("失败响应被短缓存（30s 内不重试）", async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("fail");
    });
    const tool = makeTool();
    await tool.getGroupInfo(VALID_CHAT_ID);
    await tool.getGroupInfo(VALID_CHAT_ID); // 30s 缓存期内
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("缓存 — listGroupMembers", () => {
  it("成功响应被缓存", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { items: [] } }),
    );
    const tool = makeTool();
    await tool.listGroupMembers(VALID_CHAT_ID);
    await tool.listGroupMembers(VALID_CHAT_ID);
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════
// cacheSize / clearCache
// ══════════════════════════════════════════════════════════════

describe("cacheSize / clearCache", () => {
  it("初始为 0", () => {
    const tool = makeTool();
    expect(tool.cacheSize()).toBe(0);
  });

  it("成功响应后 cacheSize +1", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { name: "运营组", description: "x" } }),
    );
    const tool = makeTool();
    await tool.getGroupInfo(VALID_CHAT_ID);
    expect(tool.cacheSize()).toBe(1);
  });

  it("clearCache 清空缓存", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { name: "运营组", description: "x" } }),
    );
    const tool = makeTool();
    await tool.getGroupInfo(VALID_CHAT_ID);
    expect(tool.cacheSize()).toBe(1);
    tool.clearCache();
    expect(tool.cacheSize()).toBe(0);
  });
});