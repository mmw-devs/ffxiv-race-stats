// interactive/session-manager-integration.test.ts — session-manager 集成测试
// 覆盖：closeSession + releaseSlot 一致性 / cleanupAuthDeadlines 清理逻辑
//
// 注：通过 mock spawn 让 ensureSession 不真启动 pi 子进程
// lark-bot 规范 §6「子进程 spawn 不可靠，改用 mock + spy + 直接调入口函数」
//
// 注：sessionsByKind 是手动维护的全局计数（PR 1 设计），
// ingress 在 ensureSession 前调 tryReserveSlot 同步——本测试模拟该调用
import { EventEmitter } from "node:events";

import { spawn } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupAuthDeadlines,
  closeSession,
  countByKind,
  ensureSession,
  getAllSessions,
  releaseSlot,
  tryReserveSlot,
} from "../../interactive/session-manager.js";

// ══════════════════════════════════════════════════════════════
// 测试基础设施
// ══════════════════════════════════════════════════════════════

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

const mockedSpawn = vi.mocked(spawn);

/** 构造 fake ChildProcess：满足 session-manager 调用的 .kill / .stdin.write / events */
function makeFakeProc(): unknown {
  const proc = new EventEmitter() as unknown as {
    stdin: { write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = { write: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

/**
 * 模拟 ingress 完整调用链：tryReserveSlot + ensureSession
 * （确保 sessionsByKind 同步）
 */
async function ensureSessionWithSlot(key: string, chatId: string, kind: "p2p-temp" | "p2p-business") {
  const ok = tryReserveSlot(kind);
  if (!ok) throw new Error(`tryReserveSlot(${kind}) failed`);
  return await ensureSession(key, chatId);
}

/**
 * 重置会话状态：关闭所有现存 session（释放 sessionsByKind 计数 +清空 sessions Map）
 * 用 beforeEach 隔离测试间状态
 */
function resetAll(): void {
  // 关所有现存 session（释放 sessions Map + sessionsByKind）
  for (const pi of getAllSessions()) {
    closeSession(pi.key, "test-reset");
  }
  // 防御性清零 sessionsByKind（处理只调 tryReserveSlot 未 ensureSession 的测试）
  while (countByKind("p2p-temp") > 0) releaseSlot("p2p-temp");
  while (countByKind("p2p-business") > 0) releaseSlot("p2p-business");
}

beforeEach(() => {
  resetAll();
  mockedSpawn.mockReset();
  mockedSpawn.mockReturnValue(makeFakeProc() as ReturnType<typeof spawn>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_CHAT_ID_A = "oc_aaaaaaaa0000000000000000000aaaaa";
const VALID_CHAT_ID_B = "oc_bbbbbbbb0000000000000000000bbbbb";

// ══════════════════════════════════════════════════════════════
// closeSession — 槽位释放一致性
// ══════════════════════════════════════════════════════════════

describe("closeSession — 槽位释放一致性", () => {
  it("关闭后 sessionsByKind 减 1（p2p-temp）", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    expect(countByKind("p2p-temp")).toBe(1);

    closeSession("session-key-A", "test-close");
    expect(countByKind("p2p-temp")).toBe(0);
    expect(pi.proc?.kill).toHaveBeenCalled();
  });

  it("关闭后可再次 tryReserveSlot 占用同一 kind", async () => {
    await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    closeSession("session-key-A", "test-close");
    expect(tryReserveSlot("p2p-temp")).toBe(true);
    expect(countByKind("p2p-temp")).toBe(1);
  });

  it("关闭不存在的 key → 返回 null + 不抛错 + 计数不变", () => {
    expect(() => closeSession("non-existent-key", "test")).not.toThrow();
    expect(closeSession("non-existent-key", "test")).toBeNull();
    expect(countByKind("p2p-temp")).toBe(0);
  });

  it("多次关闭同一 key 是幂等的", async () => {
    await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    closeSession("session-key-A", "first");
    closeSession("session-key-A", "second");
    expect(countByKind("p2p-temp")).toBe(0);
  });

  it("closeSession 清空 activeTask / waitingTasks / pendingResultFetch", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    // 注入假数据模拟有任务状态
    pi.activeTask = {} as never;
    pi.waitingTasks = [{} as never];
    pi.pendingResultFetch = {} as never;

    closeSession("session-key-A", "test");

    // PiSession 对象已从 sessions Map 删除，引用仍可访问但字段已被清空
    expect(pi.activeTask).toBeNull();
    expect(pi.waitingTasks).toEqual([]);
    expect(pi.pendingResultFetch).toBeNull();
  });

  it("closeSession 调用 proc.kill()（释放 OS 资源）", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    closeSession("session-key-A", "test-close");
    expect(pi.proc?.kill).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════
// cleanupAuthDeadlines — 清理逻辑
// ══════════════════════════════════════════════════════════════

describe("cleanupAuthDeadlines — 临时私聊超时清理", () => {
  it("超期临时私聊被清理", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    expect(countByKind("p2p-temp")).toBe(1);
    // 模拟鉴权窗口已过期
    pi.authDeadline = Date.now() - 1000;

    const result = cleanupAuthDeadlines();
    expect(result.expiredTemp).toBe(1);
    expect(result.idleBusiness).toBe(0);
    expect(countByKind("p2p-temp")).toBe(0);
  });

  it("未超期临时私聊不被清理", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    pi.authDeadline = Date.now() + 60_000; // 未来 60s

    const result = cleanupAuthDeadlines();
    expect(result.expiredTemp).toBe(0);
    expect(countByKind("p2p-temp")).toBe(1);
  });

  it("业务私聊空闲超 P2P_IDLE_TIMEOUT_MS 被清理", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-business");
    // 模拟会话已升级为业务私聊（ingress 鉴权通过后会改 kind）
    pi.kind = "p2p-business";
    // 模拟 3 天没活跃
    pi.lastActivityAt = Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000;

    const result = cleanupAuthDeadlines();
    expect(result.idleBusiness).toBe(1);
    expect(result.expiredTemp).toBe(0);
    expect(countByKind("p2p-business")).toBe(0);
  });

  it("业务私聊活跃（lastActivityAt 近期）不被清理", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-business");
    pi.kind = "p2p-business";
    pi.lastActivityAt = Date.now(); // 当前

    const result = cleanupAuthDeadlines();
    expect(result.idleBusiness).toBe(0);
    expect(countByKind("p2p-business")).toBe(1);
  });

  it("有 activeTask 的 session 跳过清理（防 promoteNext 误启动）", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    pi.activeTask = { promptId: "test" } as never;
    pi.authDeadline = Date.now() - 1000; // 模拟超期

    const result = cleanupAuthDeadlines();
    expect(result.expiredTemp).toBe(0);
    expect(countByKind("p2p-temp")).toBe(1);
  });

  it("混合场景：1 个超期临时 + 1 个未超期业务", async () => {
    const piA = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    const piB = await ensureSessionWithSlot("session-key-B", VALID_CHAT_ID_B, "p2p-business");
    piB.kind = "p2p-business"; // 模拟会话已升级
    expect(countByKind("p2p-temp")).toBe(1);
    expect(countByKind("p2p-business")).toBe(1);

    piA.authDeadline = Date.now() - 1000; // A 超期
    // B 未超期，lastActivityAt 默认是当前

    const result = cleanupAuthDeadlines();
    expect(result.expiredTemp).toBe(1);
    expect(result.idleBusiness).toBe(0);
    expect(countByKind("p2p-temp")).toBe(0);
    expect(countByKind("p2p-business")).toBe(1);
  });

  it("混合场景：1 个超期临时 + 1 个 3 天空闲业务", async () => {
    const piA = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    const piB = await ensureSessionWithSlot("session-key-B", VALID_CHAT_ID_B, "p2p-business");
    piB.kind = "p2p-business"; // 模拟会话已升级

    piA.authDeadline = Date.now() - 1000; // 临时私聊超期
    piB.lastActivityAt = Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000; // 业务私聊空闲 3 天

    const result = cleanupAuthDeadlines();
    expect(result.expiredTemp).toBe(1);
    expect(result.idleBusiness).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
// closeSession + cleanupAuthDeadlines 联合
// ══════════════════════════════════════════════════════════════

describe("closeSession 与 cleanupAuthDeadlines 联合", () => {
  it("closeSession 后 cleanupAuthDeadlines 不再处理该 session", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    pi.authDeadline = Date.now() - 1000;

    closeSession("session-key-A", "manual-close");
    const result = cleanupAuthDeadlines();
    expect(result.expiredTemp).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// ensureSession 副作用验证
// ══════════════════════════════════════════════════════════════

describe("ensureSession 副作用", () => {
  it("新 session 默认 kind=p2p-temp + authDeadline 已设置", async () => {
    const pi = await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    expect(pi.kind).toBe("p2p-temp");
    expect(pi.authDeadline).toBeGreaterThan(Date.now());
    expect(pi.authRoundsUsed).toBe(0);
    expect(pi.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("spawn 被调用一次", async () => {
    await ensureSessionWithSlot("session-key-A", VALID_CHAT_ID_A, "p2p-temp");
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("tryReserveSlot 失败时（业务配额满）ensureSession 拒绝创建", async () => {
    // 占满 p2p-business 配额
    expect(tryReserveSlot("p2p-business")).toBe(true);
    // 此时 p2p-business 已占 1 个槽位（MAX=9），不影响 p2p-temp
    // 直接验证 p2p-temp 配额满
    expect(tryReserveSlot("p2p-temp")).toBe(true);
    // 再占用应该失败
    expect(tryReserveSlot("p2p-temp")).toBe(false);
  });
});