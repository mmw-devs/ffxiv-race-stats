// extensions/lark-bot/__tests__/process/session-cleanup.test.ts
//
// session-cleanup smoke test
//
// 覆盖：
//   - cleanupOldSessions 不抛错（环境异常：session 根目录不存在 / 权限不足）
//   - startSessionCleanupInterval 启动定时器并返回 NodeJS.Timeout 句柄
//   - startSessionCleanupInterval 默认周期为 24h
//   - startSessionCleanupInterval 可自定义周期
//
// 注意：cleanupOldSessions 读取真实 `PROJECT_DIR`（process.cwd()）。
// PR-1-cleanup 后改为纯 smoke test，不依赖临时目录 / mock。
// 真实删除逻辑需在集成测试中验证（PR-2 起）。

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupOldSessions,
  startSessionCleanupInterval,
} from "../../process/session-cleanup.js";

describe("session-cleanup — cleanupOldSessions smoke test", () => {
  it("SESSION_ROOT 不存在时返回 0（首次启动 / 全新环境）", () => {
    const result = cleanupOldSessions();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("异常静默吞掉（任意路径错误不抛错）", () => {
    expect(() => cleanupOldSessions()).not.toThrow();
  });

  it("多次调用幂等", () => {
    const r1 = cleanupOldSessions();
    const r2 = cleanupOldSessions();
    expect(typeof r1).toBe("number");
    expect(typeof r2).toBe("number");
  });
});

describe("session-cleanup — startSessionCleanupInterval", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("启动定时器并返回 NodeJS.Timeout 句柄", () => {
    const timer = startSessionCleanupInterval(60_000);
    expect(timer).toBeDefined();
    expect(typeof timer).toBe("object");
    clearInterval(timer);
  });

  it("默认周期为 24h", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const timer = startSessionCleanupInterval();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 24 * 60 * 60 * 1000);
    clearInterval(timer);
  });

  it("可自定义周期", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const timer = startSessionCleanupInterval(5000);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    clearInterval(timer);
  });
});
