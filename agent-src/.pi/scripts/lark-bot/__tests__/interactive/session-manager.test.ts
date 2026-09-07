// interactive/session-manager.test.ts — session-manager 槽位 API 单元测试
// 覆盖：countAuthorized / tryReserveAuthorizedSlot / releaseAuthorizedSlot 的纯内存逻辑
//
// 注：本测试不覆盖 closeSession / ensureSession
// 后者涉及 pi 子进程 spawn，集成测试时再覆盖（lark-bot 规范 §6）
import { beforeEach, describe, expect, it } from "vitest";

import {
  countAuthorized,
  releaseAuthorizedSlot,
  tryReserveAuthorizedSlot,
} from "../../interactive/session-manager.js";

// ══════════════════════════════════════════════════════════════
// 测试基础设施：每个 describe 前清零 authorizedSlots
// ══════════════════════════════════════════════════════════════

function resetAuthorized(): void {
  while (countAuthorized() > 0) {
    releaseAuthorizedSlot();
  }
}

// ══════════════════════════════════════════════════════════════
// countAuthorized 初始状态
// ══════════════════════════════════════════════════════════════

describe("countAuthorized — 初始状态", () => {
  beforeEach(resetAuthorized);

  it("初始为 0", () => {
    expect(countAuthorized()).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// tryReserveAuthorizedSlot — 配额占用
// ══════════════════════════════════════════════════════════════

describe("tryReserveAuthorizedSlot — MAX_AUTHED_SLOTS=10", () => {
  beforeEach(resetAuthorized);

  it("首次占用成功 → count +1", () => {
    const before = countAuthorized();
    const ok = tryReserveAuthorizedSlot();
    expect(ok).toBe(true);
    expect(countAuthorized()).toBe(before + 1);
  });

  it("10 次连续占用都成功", () => {
    for (let i = 0; i < 10; i++) {
      expect(tryReserveAuthorizedSlot()).toBe(true);
    }
    expect(countAuthorized()).toBe(10);
  });

  it("第 11 次占用失败（MAX=10）", () => {
    for (let i = 0; i < 10; i++) {
      tryReserveAuthorizedSlot();
    }
    expect(tryReserveAuthorizedSlot()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// releaseAuthorizedSlot — 释放
// ══════════════════════════════════════════════════════════════

describe("releaseAuthorizedSlot — 释放计数", () => {
  beforeEach(resetAuthorized);

  it("释放后 count -1", () => {
    tryReserveAuthorizedSlot();
    releaseAuthorizedSlot();
    expect(countAuthorized()).toBe(0);
  });

  it("释放到 0 后继续 release 不会变负（防御性）", () => {
    releaseAuthorizedSlot();
    releaseAuthorizedSlot();
    releaseAuthorizedSlot();
    expect(countAuthorized()).toBe(0);
    expect(countAuthorized()).toBeGreaterThanOrEqual(0);
  });

  it("释放后再次 tryReserveAuthorizedSlot 成功（容量恢复）", () => {
    expect(tryReserveAuthorizedSlot()).toBe(true);
    for (let i = 0; i < 9; i++) tryReserveAuthorizedSlot();
    expect(tryReserveAuthorizedSlot()).toBe(false);
    releaseAuthorizedSlot();
    expect(tryReserveAuthorizedSlot()).toBe(true);
  });
});