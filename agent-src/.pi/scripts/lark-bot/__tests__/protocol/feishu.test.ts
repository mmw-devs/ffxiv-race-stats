// protocol/feishu.test.ts — 飞书 I/O 模块单元测试
//
// 覆盖：sendReplyGetId 多行 stdout 解析（PR#163 边界测试 #2 JSON 行污染）
//
// 注：通过 vi.mock("node:child_process") 拦截 spawn，不真正调用 lark-cli
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: vi.fn() };
});

const mockedSpawn = vi.mocked(spawn);

import { sendReplyGetId } from "../../protocol/feishu.js";

// ══════════════════════════════════════════════════════════════
// Mock 基础设施
// ══════════════════════════════════════════════════════════════

/**
 * 构造一个 mock child process：
 *   - stdout 是 Readable，可手动 emit data
 *   - close 事件模拟 lark-cli 进程结束
 */
function createMockChildProc() {
  const stdout = new Readable({ read() {} });
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.kill = vi.fn();
  return { proc, stdout };
}

// ══════════════════════════════════════════════════════════════
// PR#163 边界测试（issue#168 第三阶段）
// ══════════════════════════════════════════════════════════════

/**
 * PR#163 边界测试 #6：sendReplyGetId 处理 stdout 含非 JSON 行污染
 *
 * 来源: PR#163 bug #2 "JSON 行污染"
 * 触发场景: lark-cli stdout 输出混杂非 JSON 提示行（如 "[INFO] connecting..."
 *   "Found N messages"），而非纯 JSON 对象。
 * 当前行为: sendReplyGetId 用 `JSON.parse(out)` 整体解析——非 JSON 前缀导致解析失败，
 *   返回 `{ok: false, error: ...}`。这是 PR#163 描述的 bug 实际表现。
 *   listGroupMembers 已用 `out.indexOf("{")` 处理同场景（line 134-138），
 *   但 sendReplyGetId 未做对应处理。如未来修复，在本测试改为断言 ok=true。
 */
describe("PR#163 #6 sendReplyGetId — stdout JSON 行污染（当前解析失败）", () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdout 含非 JSON 前缀 + 纯 JSON → 当前返回 ok=false", async () => {
    const { proc, stdout } = createMockChildProc();
    mockedSpawn.mockReturnValue(proc as any);

    const promise = sendReplyGetId("om_msg_1", "hello");
    // 模拟 lark-cli 输出一行日志 + 真实 JSON
    stdout.push("[INFO] connecting to feishu...\n");
    stdout.push('{"data": {"message_id": "om_reply_123"}}');
    stdout.push(null); // EOF
    await new Promise((r) => setImmediate(r));
    proc.emit("close", 0);

    const result = await promise;
    // 当前行为：JSON.parse 整体失败，返回 ok=false（PR#163 bug 实际表现）
    expect(result.ok).toBe(false);
    // 注：如未来修复此 bug，应改为 expect(result.ok).toBe(true) + result.replyId === "om_reply_123"
  });
});

/**
 * PR#163 边界测试 #7：sendReplyGetId stdout 完全是 JSON（正常路径，回归）
 *
 * 触发场景: lark-cli 正常返回 JSON。
 * 当前行为: 正确解析 replyId。
 */
describe("PR#163 #7 sendReplyGetId — stdout 纯 JSON（正常路径回归）", () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdout 纯 JSON → 正确解析 replyId", async () => {
    const { proc, stdout } = createMockChildProc();
    mockedSpawn.mockReturnValue(proc as any);

    const promise = sendReplyGetId("om_msg_1", "hello");
    stdout.push('{"data": {"message_id": "om_reply_456"}}');
    stdout.push(null);
    // 等待 stdout 'data' 事件 listener 同步执行完毕
    await new Promise((r) => setImmediate(r));
    proc.emit("close", 0);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.replyId).toBe("om_reply_456");
  });
});

/**
 * PR#163 边界测试 #8：sendReplyGetId stdout 完全是非 JSON（解析失败）
 *
 * 触发场景: lark-cli 输出异常（如网络错误文本）。
 * 当前行为: JSON.parse 失败，返回 ok=false。
 */
describe("PR#163 #8 sendReplyGetId — stdout 完全非 JSON（fail-closed）", () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stdout 非 JSON → 返回 ok=false + error 含 stdout 预览", async () => {
    const { proc, stdout } = createMockChildProc();
    mockedSpawn.mockReturnValue(proc as any);

    const promise = sendReplyGetId("om_msg_1", "hello");
    stdout.push("error: connection refused");
    stdout.push(null);
    await new Promise((r) => setImmediate(r));
    proc.emit("close", 1);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
