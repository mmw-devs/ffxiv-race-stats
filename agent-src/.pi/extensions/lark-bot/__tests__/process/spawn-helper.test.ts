// extensions/lark-bot/__tests__/process/spawn-helper.test.ts
//
// spawn-helper 单元测试
// 覆盖：
//   - spawnPi 返回值 / sessionDir 格式 / chatId ":" 替换
//   - recordPiRestart 重启计数 / 风暴阈值
//   - installStdinShutdown JSON 解析
//   - getOrCreateSpawnEntry / clearSpawnEntry mutex
//   - watchPiExit exit 回调
//   - getPiRestartStats 调试输出

import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PI_BIN, PI_RESTART_MAX, PI_RESTART_WINDOW_MS } from "../../../../scripts/lark-bot/config.js";

import {
  clearSpawnEntry,
  getOrCreateSpawnEntry,
  getPiRestartStats,
  installStdinShutdown,
  recordPiRestart,
  spawnPi,
  watchPiExit,
} from "../../process/spawn-helper.js";

// ═══════════════ Mock node:child_process ═══════════════

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn } from "node:child_process";

const spawnMock = vi.mocked(spawn);

/** 创建 mock ChildProcess（stdout/stderr/stdin 为空 Stream，exit 通过 emit 触发） */
function createMockChildProc(pid = 12345) {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  const proc = new EventEmitter() as any;
  proc.pid = pid;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  proc.killed = false;
  proc.exitCode = null;
  return proc;
}

// ═══════════════ spawnPi ═══════════════

describe("spawn-helper — spawnPi", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("spawn pi 子进程（实测 2 + 6-6 验证）", () => {
    const mockProc = createMockChildProc();
    spawnMock.mockReturnValue(mockProc as any);

    const result = spawnPi({
      sessionKey: "bot-p2p-oc_abc123",
      chatId: "oc_abc123",
    });

    expect(spawnMock).toHaveBeenCalledWith(
      PI_BIN,
      ["--mode", "rpc", "--session-dir", expect.stringContaining("bot-p2p-oc_abc123")],
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ LARK_BOT_RUNTIME: "1" }),
      }),
    );
    expect(result.proc).toBe(mockProc);
    expect(result.sessionKey).toBe("bot-p2p-oc_abc123");
    expect(result.sessionDir).toContain("bot-p2p-oc_abc123");
  });

  it("chatId 含 ':' 时替换为 '-'（lark-cli 路径安全）", () => {
    const mockProc = createMockChildProc();
    spawnMock.mockReturnValue(mockProc as any);

    const result = spawnPi({
      sessionKey: "bot-p2p-test-chat",
      chatId: "oc:test:chat",
    });

    // sessionDir 中 ":" 已替换为 "-"
    expect(result.sessionDir).toContain("bot-p2p-oc-test-chat");
    expect(result.sessionDir).not.toContain("oc:test:chat");
  });

  it("sessionDir 在 .pi/sessions/ 下", () => {
    const mockProc = createMockChildProc();
    spawnMock.mockReturnValue(mockProc as any);

    const result = spawnPi({
      sessionKey: "bot-p2p-oc_xyz",
      chatId: "oc_xyz",
    });

    expect(result.sessionDir).toMatch(/\.pi\/sessions\/bot-p2p-oc_xyz$/);
  });
});

// ═══════════════ recordPiRestart ═══════════════

describe("spawn-helper — recordPiRestart", () => {
  it("前 PI_RESTART_MAX 次返回 ok", () => {
    for (let i = 0; i < PI_RESTART_MAX; i++) {
      const verdict = recordPiRestart("bot-p2p-test", `exit_${i}`);
      expect(verdict).toBe("ok");
    }
  });

  it("超过 PI_RESTART_MAX 返回 cooldown", () => {
    // 模拟 PI_RESTART_MAX + 1 次重启
    for (let i = 0; i <= PI_RESTART_MAX; i++) {
      recordPiRestart("bot-p2p-storm", `exit_${i}`);
    }
    const verdict = recordPiRestart("bot-p2p-storm", "exit_overflow");
    expect(verdict).toBe("cooldown");
  });

  it("per-session 独立计数（实测 6-6 独立 per-session）", () => {
    // session A 触发风暴
    for (let i = 0; i <= PI_RESTART_MAX; i++) {
      recordPiRestart("session-a", `a_${i}`);
    }
    expect(recordPiRestart("session-a", "a_overflow")).toBe("cooldown");

    // session B 不受影响
    expect(recordPiRestart("session-b", "b_first")).toBe("ok");
  });

  it("时间窗口外的旧记录被过滤", () => {
    // 第一次记录
    recordPiRestart("bot-p2p-time", "exit_old");
    // 模拟时间推进（PI_RESTART_WINDOW_MS 之后）
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + PI_RESTART_WINDOW_MS + 1000;
    try {
      // 新时间窗口开始，重新计数
      const verdict = recordPiRestart("bot-p2p-time", "exit_new");
      expect(verdict).toBe("ok");
    } finally {
      Date.now = realDateNow;
    }
  });
});

// ═══════════════ installStdinShutdown ═══════════════

describe("spawn-helper — installStdinShutdown", () => {
  it("收到 {\"type\":\"shutdown\"} 时触发 handler", () => {
    const handler = vi.fn();
    installStdinShutdown(handler);

    // 模拟 stdin 收到 shutdown
    const stdinListeners = (process.stdin.listeners("data") as Array<(d: Buffer) => void>);
    expect(stdinListeners.length).toBeGreaterThan(0);

    // 取最后一个 data listener（即 installStdinShutdown 注册的）
    const ourListener = stdinListeners[stdinListeners.length - 1];
    ourListener(Buffer.from('{"type":"shutdown"}\n'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("非 shutdown JSON 不触发 handler", () => {
    const handler = vi.fn();
    installStdinShutdown(handler);

    const stdinListeners = (process.stdin.listeners("data") as Array<(d: Buffer) => void>);
    const ourListener = stdinListeners[stdinListeners.length - 1];

    // 收到其他类型
    ourListener(Buffer.from('{"type":"other"}\n'));
    expect(handler).not.toHaveBeenCalled();

    // 收到无效 JSON
    ourListener(Buffer.from('not-json\n'));
    expect(handler).not.toHaveBeenCalled();
  });
});

// ═══════════════ spawn mutex（getOrCreateSpawnEntry / clearSpawnEntry） ═══════════════

describe("spawn-helper — spawn mutex", () => {
  it("同一 sessionKey 多次调用返回同一 entry（commit 4 引入）", () => {
    const e1 = getOrCreateSpawnEntry("bot-p2p-mutex");
    const e2 = getOrCreateSpawnEntry("bot-p2p-mutex");
    expect(e1).toBe(e2);
    expect(e1.promise).toBe(e2.promise);
  });

  it("不同 sessionKey 返回不同 entry", () => {
    const e1 = getOrCreateSpawnEntry("bot-p2p-a");
    const e2 = getOrCreateSpawnEntry("bot-p2p-b");
    expect(e1).not.toBe(e2);
  });

  it("clearSpawnEntry 后再次调用创建新 entry", () => {
    const e1 = getOrCreateSpawnEntry("bot-p2p-clear");
    clearSpawnEntry("bot-p2p-clear");
    const e2 = getOrCreateSpawnEntry("bot-p2p-clear");
    expect(e1).not.toBe(e2);
  });

  it("spawn promise 可 resolve / reject（实测 5：原子 Map 操作）", async () => {
    const entry = getOrCreateSpawnEntry("bot-p2p-resolve");
    const mockProc = createMockChildProc();
    entry.resolve({ proc: mockProc as any, sessionKey: "bot-p2p-resolve", sessionDir: "/tmp/test", spawnedAt: Date.now() });
    const result = await entry.promise;
    expect(result.sessionKey).toBe("bot-p2p-resolve");
  });
});

// ═══════════════ watchPiExit ═══════════════

describe("spawn-helper — watchPiExit", () => {
  it("子进程 exit 时触发 onExit 回调", () => {
    const onExit = vi.fn();
    const mockProc = createMockChildProc();
    watchPiExit(
      { proc: mockProc as any, sessionKey: "bot-p2p-watch", sessionDir: "/tmp/test", spawnedAt: Date.now() },
      onExit,
    );

    mockProc.emit("exit", 0);
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("子进程 error 时不触发 onExit（仅 exit 才触发）", () => {
    const onExit = vi.fn();
    const mockProc = createMockChildProc();
    watchPiExit(
      { proc: mockProc as any, sessionKey: "bot-p2p-err", sessionDir: "/tmp/test", spawnedAt: Date.now() },
      onExit,
    );

    mockProc.emit("error", new Error("spawn failed"));
    expect(onExit).not.toHaveBeenCalled();
  });
});

// ═══════════════ getPiRestartStats ═══════════════

describe("spawn-helper — getPiRestartStats", () => {
  afterEach(() => {
    // 清空 restartStates（用 cooldown 风暴 + 等待时间窗口外的旧记录过期）
    // 这里直接 mock Date.now 推进时间
  });

  it("返回每个 session 的重启统计", () => {
    recordPiRestart("bot-p2p-stats-1", "exit_1");
    recordPiRestart("bot-p2p-stats-1", "exit_2");
    recordPiRestart("bot-p2p-stats-2", "exit_x");

    const stats = getPiRestartStats();
    // sessionKey 在返回中被截断为 slice(-12)
    expect(stats["-p2p-stats-1"]).toBeDefined();
    expect(stats["-p2p-stats-1"].count).toBeGreaterThanOrEqual(2);
    expect(stats["-p2p-stats-1"].reason).toBe("exit_2");
  });
});
