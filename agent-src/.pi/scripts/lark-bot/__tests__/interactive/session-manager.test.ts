// interactive/session-manager.test.ts — session-manager 新增 API 单元测试
// 覆盖：countByKind / tryReserveSlot / releaseSlot 的纯内存逻辑
//
// 注：本测试不覆盖 closeSession / cleanupAuthDeadlines / ensureSession
// 后者涉及 pi 子进程 spawn，集成测试时再覆盖（lark-bot 规范 §6）
//
// 注：sessionsByKind 是模块私有全局状态，每个测试前必须清零（通过 releaseSlot 调到 0）
import { beforeEach, describe, expect, it } from "vitest";

import {
  countByKind,
  releaseSlot,
  tryReserveSlot,
} from "../../interactive/session-manager.js";

// ══════════════════════════════════════════════════════════════
// 测试基础设施：每个 describe 前清零 sessionsByKind
// ══════════════════════════════════════════════════════════════

function resetKind(kind: "p2p-temp" | "p2p-business"): void {
  while (countByKind(kind) > 0) {
    releaseSlot(kind);
  }
}

function resetAll(): void {
  resetKind("p2p-temp");
  resetKind("p2p-business");
}

// ══════════════════════════════════════════════════════════════
// countByKind 初始状态
// ══════════════════════════════════════════════════════════════

describe("countByKind — 初始状态", () => {
  beforeEach(resetAll);

  it("p2p-temp 初始为 0", () => {
    expect(countByKind("p2p-temp")).toBe(0);
  });

  it("p2p-business 初始为 0", () => {
    expect(countByKind("p2p-business")).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// tryReserveSlot — 配额占用
// ══════════════════════════════════════════════════════════════

describe("tryReserveSlot — p2p-temp（MAX=1）", () => {
  beforeEach(resetAll);

  it("首次占用成功 → count +1", () => {
    const before = countByKind("p2p-temp");
    const ok = tryReserveSlot("p2p-temp");
    expect(ok).toBe(true);
    expect(countByKind("p2p-temp")).toBe(before + 1);
  });

  it("占用后配额已满 → 返回 false", () => {
    expect(tryReserveSlot("p2p-temp")).toBe(true);
    expect(tryReserveSlot("p2p-temp")).toBe(false);
  });
});

describe("tryReserveSlot — p2p-business（MAX=9）", () => {
  beforeEach(resetAll);

  it("9 次连续占用都成功", () => {
    for (let i = 0; i < 9; i++) {
      expect(tryReserveSlot("p2p-business")).toBe(true);
    }
    expect(countByKind("p2p-business")).toBe(9);
  });

  it("第 10 次占用失败（MAX=9）", () => {
    for (let i = 0; i < 9; i++) {
      tryReserveSlot("p2p-business");
    }
    expect(tryReserveSlot("p2p-business")).toBe(false);
  });
});

describe("tryReserveSlot — 临时与业务配额独立", () => {
  beforeEach(resetAll);

  it("p2p-temp 操作不影响 p2p-business 计数", () => {
    tryReserveSlot("p2p-temp");
    tryReserveSlot("p2p-business");
    expect(countByKind("p2p-temp")).toBe(1);
    expect(countByKind("p2p-business")).toBe(1);
    releaseSlot("p2p-temp");
    // p2p-business 计数不受 p2p-temp 操作影响
    expect(countByKind("p2p-business")).toBe(1);
  });

  it("p2p-business 操作不影响 p2p-temp 计数", () => {
    tryReserveSlot("p2p-temp");
    tryReserveSlot("p2p-business");
    releaseSlot("p2p-business");
    expect(countByKind("p2p-temp")).toBe(1);
    expect(countByKind("p2p-business")).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// releaseSlot — 释放
// ══════════════════════════════════════════════════════════════

describe("releaseSlot — 释放计数", () => {
  beforeEach(resetAll);

  it("释放后 count -1", () => {
    tryReserveSlot("p2p-temp");
    releaseSlot("p2p-temp");
    expect(countByKind("p2p-temp")).toBe(0);
  });

  it("释放到 0 后继续 release 不会变负（防御性）", () => {
    // 从 0 开始多次 release
    releaseSlot("p2p-temp");
    releaseSlot("p2p-temp");
    releaseSlot("p2p-temp");
    expect(countByKind("p2p-temp")).toBe(0);
    expect(countByKind("p2p-temp")).toBeGreaterThanOrEqual(0);
  });

  it("释放后再次 tryReserveSlot 成功（容量恢复）", () => {
    expect(tryReserveSlot("p2p-temp")).toBe(true);
    expect(tryReserveSlot("p2p-temp")).toBe(false);
    releaseSlot("p2p-temp");
    expect(tryReserveSlot("p2p-temp")).toBe(true);
  });
});