// identity-resolver.test.ts — identity-resolver 模块单元测试
// 覆盖：open_id 格式校验、注册表查找、缓存、fail-closed
//
// 注：lark-cli 调用部分通过 dependency injection（vi.spyOn on execFileSync）
// 单元测试不实际调用 lark-cli，避免依赖飞书环境
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { createIdentityResolver, type IdentityResolver } from "../identity-resolver.js";

// ══════════════════════════════════════════════════════════════
// 测试基础设施
// ══════════════════════════════════════════════════════════════

const PROJECT_DIR = "/tmp/test-project";
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

function makeResolver(): IdentityResolver {
  return createIdentityResolver({
    projectDir: PROJECT_DIR,
    cliPath: CLI_PATH,
    log: () => {}, // 静音测试日志
  });
}

const VALID_OPEN_ID = "ou_abcdef0123456789abcdef0123456789";

beforeEach(() => {
  mockedExecFileSync.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════
// open_id 格式校验
// ══════════════════════════════════════════════════════════════

describe("open_id 格式校验", () => {
  it("合法格式 ou_ + 32 位 hex 通过", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { user: { user_id: "38a32652" } } }),
    );
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx).not.toBeNull();
    expect(ctx?.operator).toBe("38a32652");
  });

  it("非 ou_ 前缀被拒", async () => {
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator("xx_abcdef0123456789abcdef0123456789");
    expect(ctx).toBeNull();
    // 不应触发 lark-cli 调用
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("空字符串被拒", async () => {
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator("");
    expect(ctx).toBeNull();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("长度不足被拒", async () => {
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator("ou_abc");
    expect(ctx).toBeNull();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("长度超出被拒", async () => {
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator("ou_" + "a".repeat(33));
    expect(ctx).toBeNull();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════
// OPERATOR_REGISTRY 校验
// ══════════════════════════════════════════════════════════════

describe("OPERATOR_REGISTRY 校验", () => {
  it("已注册 user_id 返回 OperatorContext", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { user: { user_id: "38a32652" } } }),
    );
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx).toEqual({
      operator: "38a32652",
      claim: "user_id",
      name: "weunimix",
    });
  });

  it("第二个注册 user_id 311a2ea5（赤墓）也能解析", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { user: { user_id: "311a2ea5" } } }),
    );
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx?.name).toBe("赤墓");
  });

  it("未注册的 user_id 返回 null（fail-closed）", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { user: { user_id: "hacker_id" } } }),
    );
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// lark-cli 响应解析
// ══════════════════════════════════════════════════════════════

describe("lark-cli 响应解析", () => {
  it("JSON 解析失败 → null", async () => {
    mockedExecFileSync.mockReturnValueOnce("not valid json {");
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx).toBeNull();
  });

  it("data.user.user_id 缺失 → null", async () => {
    mockedExecFileSync.mockReturnValueOnce(JSON.stringify({ data: {} }));
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx).toBeNull();
  });

  it("data.user.user_id 类型错误 → null", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { user: { user_id: 12345 } } }),
    );
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx).toBeNull();
  });

  it("data.user.user_id 空字符串 → null", async () => {
    mockedExecFileSync.mockReturnValueOnce(
      JSON.stringify({ data: { user: { user_id: "" } } }),
    );
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx).toBeNull();
  });

  it("execFileSync 抛出 → null", async () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error("spawn ENOENT");
    });
    const resolver = makeResolver();
    const ctx = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// 缓存
// ══════════════════════════════════════════════════════════════

describe("缓存", () => {
  it("第二次同 open_id 调用复用缓存", async () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ data: { user: { user_id: "38a32652" } } }),
    );
    const resolver = makeResolver();

    const ctx1 = await resolver.resolveOperator(VALID_OPEN_ID);
    const ctx2 = await resolver.resolveOperator(VALID_OPEN_ID);

    expect(ctx1?.operator).toBe("38a32652");
    expect(ctx2?.operator).toBe("38a32652");
    expect(ctx1).toEqual(ctx2);
    // 只调用一次 lark-cli
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(resolver.cacheSize()).toBe(1);
  });

  it("失败结果缓存 30s TTL（短期内不重试）", async () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error("api error");
    });
    const resolver = makeResolver();

    const ctx1 = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx1).toBeNull();

    // 第二次调用：缓存命中失败结果，不应触发 lark-cli
    const ctx2 = await resolver.resolveOperator(VALID_OPEN_ID);
    expect(ctx2).toBeNull();
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("不同 open_id 不共享缓存", async () => {
    const OTHER_OPEN_ID = "ou_11111111111111111111111111111111";
    mockedExecFileSync.mockImplementation((_cli, args) => {
      // 根据 open_id 返回不同 user_id（模拟不同用户）
      const openId = (args as string[])[(args as string[]).indexOf("--user-id") + 1];
      const userId = openId === VALID_OPEN_ID ? "38a32652" : "311a2ea5";
      return JSON.stringify({ data: { user: { user_id: userId } } });
    });
    const resolver = makeResolver();

    const ctx1 = await resolver.resolveOperator(VALID_OPEN_ID);
    const ctx2 = await resolver.resolveOperator(OTHER_OPEN_ID);

    expect(ctx1?.operator).toBe("38a32652");
    expect(ctx2?.operator).toBe("311a2ea5");
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
    expect(resolver.cacheSize()).toBe(2);
  });

  it("clearCache 清空所有缓存", async () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ data: { user: { user_id: "38a32652" } } }),
    );
    const resolver = makeResolver();

    await resolver.resolveOperator(VALID_OPEN_ID);
    expect(resolver.cacheSize()).toBe(1);

    resolver.clearCache();
    expect(resolver.cacheSize()).toBe(0);

    // 再次 resolve 应重新调用 lark-cli
    await resolver.resolveOperator(VALID_OPEN_ID);
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════════
// 集成场景
// ══════════════════════════════════════════════════════════════

describe("集成场景", () => {
  it("未注册用户反复调用：fail-closed + 缓存生效", async () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ data: { user: { user_id: "hacker" } } }),
    );
    const resolver = makeResolver();

    const results = await Promise.all([
      resolver.resolveOperator(VALID_OPEN_ID),
      resolver.resolveOperator(VALID_OPEN_ID),
      resolver.resolveOperator(VALID_OPEN_ID),
    ]);

    expect(results.every((r) => r === null)).toBe(true);
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("混合用户：weunimix 通过，hacker 拒绝，缓存隔离", async () => {
    const HACKER_OPEN_ID = "ou_22222222222222222222222222222222";
    mockedExecFileSync.mockImplementation((_cli, args) => {
      const openId = (args as string[])[(args as string[]).indexOf("--user-id") + 1];
      const userId = openId === VALID_OPEN_ID ? "38a32652" : "hacker";
      return JSON.stringify({ data: { user: { user_id: userId } } });
    });
    const resolver = makeResolver();

    const legit = await resolver.resolveOperator(VALID_OPEN_ID);
    const hacker = await resolver.resolveOperator(HACKER_OPEN_ID);

    expect(legit?.operator).toBe("38a32652");
    expect(hacker).toBeNull();
    expect(resolver.cacheSize()).toBe(2);
  });
});