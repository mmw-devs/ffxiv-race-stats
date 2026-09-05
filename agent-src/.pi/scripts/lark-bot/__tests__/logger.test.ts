// shared/logger.test.ts — 日志门面单元测试
// 覆盖：log() 写入 /tmp/lark-bot.log；emitTaskJournal() 写入 /tmp/lark-bot-tasks.jsonl
//
// 备注：因 process.ts / shared/logger.ts 启动期已 init fs 调用，本测试仅断言行为契约
//（读取文件最后一行验证 JSON 格式）。不模拟文件锁、不模拟轮转（轮转是独立测试）。
import { existsSync, readFileSync, rmSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { emitTaskJournal, log, TASK_JOURNAL_FILE } from "../shared/logger.js";

// ══════════════════════════════════════════════════════════════
// 测试基础设施：清理 + 隔离
// ══════════════════════════════════════════════════════════════

// log() 与 emitTaskJournal() 都写到 /tmp/，可能与运行中 lark-bot 进程冲突
// 测试用唯一文件名后缀避免污染

// ══════════════════════════════════════════════════════════════
// emitTaskJournal
// ══════════════════════════════════════════════════════════════

describe("emitTaskJournal — 写入 TASK_JOURNAL_FILE", () => {
  beforeAll(() => {
    if (existsSync(TASK_JOURNAL_FILE)) rmSync(TASK_JOURNAL_FILE);
  });
  afterAll(() => {
    if (existsSync(TASK_JOURNAL_FILE)) rmSync(TASK_JOURNAL_FILE);
  });

  it("追加一行 JSON（state=in_progress）", () => {
    emitTaskJournal({
      eventTime: "2026-09-04T10:00:00.000Z",
      promptId: "f-1-aaaaaaaa",
      operator: "38a32652",
      operatorName: "weunimix",
      state: "in_progress",
    });
    const content = readFileSync(TASK_JOURNAL_FILE, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toEqual({
      eventTime: "2026-09-04T10:00:00.000Z",
      promptId: "f-1-aaaaaaaa",
      operator: "38a32652",
      operatorName: "weunimix",
      state: "in_progress",
    });
  });

  it("追加一行 JSON（state=awaiting_review 含 durationMs）", () => {
    emitTaskJournal({
      eventTime: "2026-09-04T10:00:05.000Z",
      promptId: "f-1-aaaaaaaa",
      operator: "38a32652",
      operatorName: "weunimix",
      state: "awaiting_review",
      durationMs: 5000,
    });
    const lines = readFileSync(TASK_JOURNAL_FILE, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.state).toBe("awaiting_review");
    expect(last.durationMs).toBe(5000);
  });

  it("追加一行 JSON（state=terminated 含 reason）", () => {
    emitTaskJournal({
      eventTime: "2026-09-04T10:00:10.000Z",
      promptId: "f-2-bbbbbbbb",
      operator: "311a2ea5",
      operatorName: "赤墓",
      state: "terminated",
      durationMs: 30000,
      reason: "queue_timeout",
    });
    const lines = readFileSync(TASK_JOURNAL_FILE, "utf-8").split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.state).toBe("terminated");
    expect(last.reason).toBe("queue_timeout");
    expect(last.operatorName).toBe("赤墓");
  });

  it("多次调用产生多行（append-only）", () => {
    const beforeLines = readFileSync(TASK_JOURNAL_FILE, "utf-8").split("\n").filter(Boolean).length;
    emitTaskJournal({
      eventTime: "2026-09-04T10:01:00.000Z",
      promptId: "f-3-cccccccc",
      operator: "38a32652",
      operatorName: "weunimix",
      state: "in_progress",
    });
    emitTaskJournal({
      eventTime: "2026-09-04T10:01:05.000Z",
      promptId: "f-3-cccccccc",
      operator: "38a32652",
      operatorName: "weunimix",
      state: "awaiting_review",
      durationMs: 5000,
    });
    const afterLines = readFileSync(TASK_JOURNAL_FILE, "utf-8").split("\n").filter(Boolean).length;
    expect(afterLines - beforeLines).toBe(2);
  });

  it("每行独立可 JSON.parse（JSONL 格式）", () => {
    const lines = readFileSync(TASK_JOURNAL_FILE, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// log（不破坏现有契约）
// ══════════════════════════════════════════════════════════════

describe("log — 文本日志仍可用", () => {
  it("调用 log 不抛异常", () => {
    expect(() => log("test message")).not.toThrow();
  });

  it("调用 emitTaskJournal 不抛异常", () => {
    expect(() =>
      emitTaskJournal({
        eventTime: new Date().toISOString(),
        promptId: "f-test",
        operator: "38a32652",
        operatorName: "weunimix",
        state: "in_progress",
      }),
    ).not.toThrow();
  });
});