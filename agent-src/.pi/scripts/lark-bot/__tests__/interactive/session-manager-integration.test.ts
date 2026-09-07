// interactive/session-manager-integration.test.ts — session-manager 集成测试
// 覆盖：closeSession + authorized 槽位释放一致性 + ensureSession 默认状态
//
// 注：通过 mock spawn 让 ensureSession 不真启动 pi 子进程
// lark-bot 规范 §6「子进程 spawn 不可靠，改用 mock + spy + 直接调入口函数」
import { EventEmitter } from "node:events";

import { spawn } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeSession,
  countAuthorized,
  ensureSession,
  getAllSessions,
  getPiSession,
  releaseAuthorizedSlot,
  tryReserveAuthorizedSlot,
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
 * 模拟 ingress 完整调用链：tryReserveAuthorizedSlot + ensureSession
 * （确保 authorizedSlots 同步）
 */
async function ensureSessionWithAuthSlot(key: string, chatId: string) {
  const ok = tryReserveAuthorizedSlot();
  if (!ok) throw new Error(`tryReserveAuthorizedSlot failed`);
  return await ensureSession(key, chatId);
}

/**
 * 重置会话状态：关闭所有现存 session（释放 sessions Map + authorizedSlots）
 * 用 beforeEach 隔离测试间状态
 */
function resetAll(): void {
  // 关所有现存 session（释放 sessions Map + authorizedSlots）
  for (const pi of getAllSessions()) {
    closeSession(pi.key, "test-reset");
  }
  // 防御性清零 authorizedSlots（处理只调 tryReserveAuthorizedSlot 未 ensureSession 的测试）
  while (countAuthorized() > 0) releaseAuthorizedSlot();
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
const VALID_CHAT_ID_C = "oc_cccccccc0000000000000000000ccccc";

// ══════════════════════════════════════════════════════════════
// closeSession — 槽位释放一致性
// ══════════════════════════════════════════════════════════════

describe("closeSession — 已鉴权会话槽位释放", () => {
  it("关闭已鉴权会话后 countAuthorized 减 1", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    pi.authorized = true; // 模拟 ingress 鉴权通过后置位
    expect(countAuthorized()).toBe(1);

    closeSession("session-key-A", "test-close");
    expect(countAuthorized()).toBe(0);
    expect(pi.proc?.kill).toHaveBeenCalled();
  });

  it("关闭未鉴权会话不释放槽位（避免误释放别人的配额）", async () => {
    await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    // 注意：pi.authorized 保持 false
    expect(countAuthorized()).toBe(1);

    closeSession("session-key-A", "test-close");
    // 未鉴权会话不释放 authorizedSlots（手动通过 releaseAuthorizedSlot 释放）
    expect(countAuthorized()).toBe(1);
    releaseAuthorizedSlot(); // 模拟 ingress 在 closeSession 后手动释放
    expect(countAuthorized()).toBe(0);
  });

  it("关闭已鉴权会话后可再次 tryReserveAuthorizedSlot 占用", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    pi.authorized = true; // 模拟 ingress 鉴权通过后置位
    expect(countAuthorized()).toBe(1);

    // closeSession 检测到 pi.authorized=true → 自动 releaseAuthorizedSlot()
    closeSession("session-key-A", "test-close");
    expect(countAuthorized()).toBe(0);

    // 槽位已释放，可重新占用
    expect(tryReserveAuthorizedSlot()).toBe(true);
    expect(countAuthorized()).toBe(1);
  });

  it("关闭不存在的 key → 返回 null + 不抛错 + 计数不变", () => {
    expect(() => closeSession("non-existent-key", "test")).not.toThrow();
    expect(closeSession("non-existent-key", "test")).toBeNull();
    expect(countAuthorized()).toBe(0);
  });

  it("多次关闭同一 key 是幂等的", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    pi.authorized = true;
    closeSession("session-key-A", "first");
    closeSession("session-key-A", "second");
    expect(countAuthorized()).toBe(0);
  });

  it("closeSession 清空 activeTask / waitingTasks / pendingResultFetch", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
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
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    closeSession("session-key-A", "test-close");
    expect(pi.proc?.kill).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════
// ensureSession 副作用验证
// ══════════════════════════════════════════════════════════════

describe("ensureSession 副作用", () => {
  it("新 session 默认 authorized=false", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    expect(pi.authorized).toBe(false);
  });

  it("spawn 被调用一次", async () => {
    await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("鉴权后设置 authorized=true → closeSession 释放槽位", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    pi.authorized = true; // 模拟 ingress 鉴权通过
    expect(countAuthorized()).toBe(1);

    closeSession("session-key-A", "matched-done");
    expect(countAuthorized()).toBe(0);
  });

  it("/switch 关闭会话后下次 ensureSession 创建新 session（authorized=false）", async () => {
    const pi1 = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    pi1.authorized = true;
    closeSession("session-key-A", "/switch");

    // 重新创建会话（同一 chat_id → 同一 key）
    const pi2 = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    expect(pi2.authorized).toBe(false);
    // 两次创建是不同的 session 对象
    expect(pi1).not.toBe(pi2);
  });
});

// ══════════════════════════════════════════════════════════════
// 混合场景
// ══════════════════════════════════════════════════════════════

describe("多 session 混合", () => {
  it("独立会话的 authorized 状态互不影响", async () => {
    const piA = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    const piB = await ensureSessionWithAuthSlot("session-key-B", VALID_CHAT_ID_B);

    piA.authorized = true;
    expect(piA.authorized).toBe(true);
    expect(piB.authorized).toBe(false);
  });

  it("配额满时（MAX_AUTHED_SLOTS=10）无法创建第 11 个已鉴权会话", () => {
    for (let i = 0; i < 10; i++) {
      expect(tryReserveAuthorizedSlot()).toBe(true);
    }
    expect(tryReserveAuthorizedSlot()).toBe(false);
    expect(countAuthorized()).toBe(10);
  });
});

// ══════════════════════════════════════════════════════════════
// PI Agent close_session 事件（语义层主动关闭会话）
// ══════════════════════════════════════════════════════════════

describe("close_session 事件（PI Agent stdout NDJSON）", () => {
  /**
   * 触发 close_session 事件：
   * 通过 fake proc.stdout emit NDJSON 模拟 PI Agent 输出事件。
   * handlePiEvent 从 stdout 读 NDJSON → 解析 → switch 路由。
   */
  function emitCloseSession(key: string, reason?: string): void {
    const pi = getAllSessions().find(s => s.key === key);
    if (!pi) throw new Error(`session not found: ${key}`);
    const event = reason ? { type: "close_session", reason } : { type: "close_session" };
    (pi.proc as any)?.stdout?.emit("data", Buffer.from(JSON.stringify(event) + "\n"));
  }

  it("已鉴权会话收到 close_session → 关闭 + 释放槽位", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    pi.authorized = true;
    expect(countAuthorized()).toBe(1);

    emitCloseSession("session-key-A", "user_said_done");

    // close_session 后会话销毁、槽位释放
    expect(countAuthorized()).toBe(0);
    expect(getAllSessions().find(s => s.key === "session-key-A")).toBeUndefined();
    expect(pi.proc?.kill).toHaveBeenCalled();
  });

  it("未鉴权会话收到 close_session → 关闭但不释放 authorized 槽位", async () => {
    await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    expect(countAuthorized()).toBe(1);

    emitCloseSession("session-key-A");

    expect(countAuthorized()).toBe(1); // 未鉴权会话不占 authorized 计数
    expect(getAllSessions().find(s => s.key === "session-key-A")).toBeUndefined();
  });

  it("close_session 不依赖 reason 字段（可选）", async () => {
    await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    emitCloseSession("session-key-A"); // 不传 reason
    expect(getAllSessions().find(s => s.key === "session-key-A")).toBeUndefined();
  });

  it("close_session 后下次 ensureSession 创建全新 session（authorized=false）", async () => {
    const pi1 = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    pi1.authorized = true;
    emitCloseSession("session-key-A");

    const pi2 = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    expect(pi2.authorized).toBe(false);
    expect(pi1).not.toBe(pi2);
  });
});

// ══════════════════════════════════════════════════════════════
// 兜底解析：PI Agent 把 close_session JSON 当回复内容输出
// ══════════════════════════════════════════════════════════════

describe("PI Agent 文本中 close_session JSON 兜底解析", () => {
  /**
   * 模拟 PI Agent 业务处理返回文本（get_last_assistant_text）
   * 通过 fake proc.stdout emit response 事件
   */
  function emitAgentText(key: string, text: string): void {
    // 必须用 getPiSession 拿原 pi 引用（getAllSessions 返回 shallow copy，写字段无效）
    const pi = getPiSession(key);
    if (!pi) throw new Error(`session not found: ${key}`);
    if (!pi.pendingResultFetch) {
      // 初始化 pendingResultFetch（业务处理完成态）
      pi.pendingResultFetch = {
        task: {} as any,
        expectedId: "result-test",
        resolve: () => {},
      };
    }
    pi.finishing = true;
    const response = {
      type: "response",
      command: "get_last_assistant_text",
      id: "result-test",
      success: true,
      data: { text },
    };
    (pi.proc as any)?.stdout?.emit("data", Buffer.from(JSON.stringify(response) + "\n"));
  }

  it("纯 JSON 文本含 close_session → 兜底关闭", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-A", VALID_CHAT_ID_A);
    pi.authorized = true;
    expect(countAuthorized()).toBe(1);

    emitAgentText("session-key-A", `任务已完成。\n\n{"type":"close_session","reason":"user_said_done"}\n`);

    expect(countAuthorized()).toBe(0);
    expect(getAllSessions().find(s => s.key === "session-key-A")).toBeUndefined();
  });

  it("markdown 代码块含 close_session JSON → 兜底关闭", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-B", VALID_CHAT_ID_B);
    pi.authorized = true;

    emitAgentText(
      "session-key-B",
      `好的，任务结束。\n\n\`\`\`json\n{"type":"close_session","reason":"user_said_done"}\n\`\`\``,
    );

    expect(countAuthorized()).toBe(0);
    expect(getAllSessions().find(s => s.key === "session-key-B")).toBeUndefined();
  });

  it("业务文本中不包含 close_session JSON → 不触发关闭", async () => {
    const pi = await ensureSessionWithAuthSlot("session-key-C", VALID_CHAT_ID_C);
    pi.authorized = true;
    expect(countAuthorized()).toBe(1);

    emitAgentText("session-key-C", "这是正常业务回复，不含关闭指令。");

    expect(countAuthorized()).toBe(1);
    expect(getAllSessions().find(s => s.key === "session-key-C")).toBeDefined();
  });
});