// extensions/lark-bot/__tests__/process/children-registry.test.ts
//
// children-registry 单元测试（实测 6-3 强制要求）
// 覆盖：
//   - trackChild 增加 + exit 自动 remove
//   - untrackChild 手动移除
//   - killAllChildren 遍历 kill（实测 6-3 强制要求）
//   - getChildrenCount / getChildrenSnapshot
//   - 已退出 / 已 killed 的子进程不被重复 kill

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetChildrenForTesting,
  getChildrenCount,
  getChildrenSnapshot,
  killAllChildren,
  trackChild,
  untrackChild,
} from "../../process/children-registry.js";

// ═══════════════ Test fixtures ═══════════════

/**
 * 创建 mock ChildProcess。
 * 不真的 spawn——用 EventEmitter 模拟 exit / kill 行为。
 */
function createMockChild(opts: { killed?: boolean; exitCode?: number | null } = {}) {
  const child = new EventEmitter() as any;
  child.killed = opts.killed ?? false;
  child.exitCode = opts.exitCode ?? null;
  child.kill = vi.fn((_signal?: NodeJS.Signals) => {
    child.killed = true;
    // 模拟子进程收到信号后退出
    setImmediate(() => child.emit("exit", null));
    return true;
  });
  return child as EventEmitter & { killed: boolean; exitCode: number | null; kill: ReturnType<typeof vi.fn> };
}

// ═══════════════ Tests ═══════════════

describe("children-registry — trackChild / untrackChild", () => {
  beforeEach(() => {
    __resetChildrenForTesting();
  });
  afterEach(() => {
    __resetChildrenForTesting();
  });

  it("trackChild 增加子进程到 Set", () => {
    const child = createMockChild();
    trackChild(child);
    expect(getChildrenCount()).toBe(1);
    expect(getChildrenSnapshot()).toContain(child);
  });

  it("子进程 exit 时自动从 Set 中移除（实测 5 原子操作）", () => {
    const child = createMockChild();
    trackChild(child);
    expect(getChildrenCount()).toBe(1);

    child.emit("exit", 0);
    expect(getChildrenCount()).toBe(0);
  });

  it("untrackChild 手动移除（不 kill）", () => {
    const child = createMockChild();
    trackChild(child);
    untrackChild(child);
    expect(getChildrenCount()).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("多次 trackChild 同一子进程：Set 自动去重", () => {
    const child = createMockChild();
    trackChild(child);
    trackChild(child);
    trackChild(child);
    expect(getChildrenCount()).toBe(1);
  });
});

describe("children-registry — killAllChildren（实测 6-3 强制要求）", () => {
  beforeEach(() => {
    __resetChildrenForTesting();
  });
  afterEach(() => {
    __resetChildrenForTesting();
  });

  it("遍历所有 tracked children 发送 SIGTERM", () => {
    const c1 = createMockChild();
    const c2 = createMockChild();
    const c3 = createMockChild();
    trackChild(c1);
    trackChild(c2);
    trackChild(c3);

    const killed = killAllChildren();
    expect(killed).toBe(3);
    expect(c1.kill).toHaveBeenCalledWith("SIGTERM");
    expect(c2.kill).toHaveBeenCalledWith("SIGTERM");
    expect(c3.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("遍历后清空 Set（不允许残留）", () => {
    const c1 = createMockChild();
    trackChild(c1);
    killAllChildren();
    expect(getChildrenCount()).toBe(0);
  });

  it("已退出的子进程（exitCode !== null）跳过", () => {
    const alive = createMockChild();
    const dead = createMockChild({ exitCode: 0 });
    trackChild(alive);
    trackChild(dead);

    const killed = killAllChildren();
    expect(killed).toBe(1); // 只 kill alive
    expect(alive.kill).toHaveBeenCalled();
    expect(dead.kill).not.toHaveBeenCalled();
  });

  it("已 killed 的子进程跳过（幂等）", () => {
    const alreadyKilled = createMockChild({ killed: true });
    const alive = createMockChild();
    trackChild(alreadyKilled);
    trackChild(alive);

    const killed = killAllChildren();
    expect(killed).toBe(1);
    expect(alive.kill).toHaveBeenCalled();
    expect(alreadyKilled.kill).not.toHaveBeenCalled();
  });

  it("自定义 signal", () => {
    const child = createMockChild();
    trackChild(child);
    killAllChildren("SIGKILL");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("kill 抛错时不影响其他子进程（best-effort）", () => {
    const c1 = createMockChild();
    const c2 = createMockChild();
    trackChild(c1);
    trackChild(c2);
    c1.kill = vi.fn(() => {
      throw new Error("EPERM");
    });

    // 不抛错，c2 仍被 kill
    const killed = killAllChildren();
    expect(killed).toBe(1); // c2
    expect(c1.kill).toHaveBeenCalled();
    expect(c2.kill).toHaveBeenCalled();
  });
});

describe("children-registry — getChildrenSnapshot", () => {
  beforeEach(() => {
    __resetChildrenForTesting();
  });

  it("返回 Set 快照（数组形式）", () => {
    const c1 = createMockChild();
    const c2 = createMockChild();
    trackChild(c1);
    trackChild(c2);

    const snap = getChildrenSnapshot();
    expect(Array.isArray(snap)).toBe(true);
    expect(snap).toHaveLength(2);
    expect(snap).toContain(c1);
    expect(snap).toContain(c2);
  });

  it("空 Set 返回空数组", () => {
    expect(getChildrenSnapshot()).toEqual([]);
  });
});
