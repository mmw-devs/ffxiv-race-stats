// business/ingress-close-intent.test.ts — matchesCloseIntent 关键词匹配单测
import { describe, expect, it } from "vitest";

import { matchesCloseIntent } from "../../ingress.js";

describe("matchesCloseIntent — 中文/英文结束意图", () => {
  it("应匹配: 单独关键词", () => {
    expect(matchesCloseIntent("结束")).toBe(true);
    expect(matchesCloseIntent("结束任务")).toBe(true);
    expect(matchesCloseIntent("结束会话")).toBe(true);
    expect(matchesCloseIntent("完毕")).toBe(true);
    expect(matchesCloseIntent("完成")).toBe(true);
  });

  it("应匹配: '好的...结束' 变体", () => {
    expect(matchesCloseIntent("好的，任务结束了")).toBe(true);
    expect(matchesCloseIntent("好的 任务结束了")).toBe(true);
    expect(matchesCloseIntent("好的完成")).toBe(true);
    expect(matchesCloseIntent("好的，完毕")).toBe(true);
  });

  it("应匹配: 英文简写", () => {
    expect(matchesCloseIntent("done")).toBe(true);
    expect(matchesCloseIntent("DONE")).toBe(true);
    expect(matchesCloseIntent("exit")).toBe(true);
    expect(matchesCloseIntent("quit")).toBe(true);
    expect(matchesCloseIntent("bye")).toBe(true);
  });

  it("应匹配: 再见（前缀）", () => {
    expect(matchesCloseIntent("再见")).toBe(true);
    expect(matchesCloseIntent("再见了 👋")).toBe(true);
  });

  it("应匹配: 带末尾标点", () => {
    expect(matchesCloseIntent("结束任务。")).toBe(true);
    expect(matchesCloseIntent("结束任务！")).toBe(true);
    expect(matchesCloseIntent("结束任务~")).toBe(true);
    expect(matchesCloseIntent("结束。")).toBe(true);
    expect(matchesCloseIntent("完毕。")).toBe(true);
    expect(matchesCloseIntent("完成！")).toBe(true);
    expect(matchesCloseIntent("done.")).toBe(true);
  });

  it("不应匹配: 包含业务关键词的句子", () => {
    expect(matchesCloseIntent("结束 bossHP 更新")).toBe(false);
    expect(matchesCloseIntent("任务已结束，请继续监控")).toBe(false);
    expect(matchesCloseIntent("done 这个任务吧")).toBe(false);
    expect(matchesCloseIntent("请结束当前操作并保存")).toBe(false);
  });

  it("不应匹配: 空 / 纯空格", () => {
    expect(matchesCloseIntent("")).toBe(false);
    expect(matchesCloseIntent("   ")).toBe(false);
  });
});