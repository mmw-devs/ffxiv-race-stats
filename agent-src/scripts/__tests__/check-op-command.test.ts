// check-op-command.test.ts — CI 闸门：指令 id 与级别必须来自契约
import { describe, expect, it } from "vitest";

import { checkMessage, commandIndex } from "../check-op-command.js";
import { loadContract } from "../ops-contract.js";

const index = commandIndex(loadContract());

const log = (body: object): string =>
  `content: 测试提交\n\n\`\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\`\n`;

describe("check-op-command — commit 消息里的指令声明", () => {
  it("契约内的 id 通过", () => {
    const message = log({
      operator: "tester",
      timestamp: "2026-01-01T00:00:00Z",
      command: "progress.update",
      changes: [],
    });
    expect(checkMessage(message, index)).toEqual([]);
  });

  it("声明了级别且与契约一致时通过", () => {
    const message = log({
      operator: "tester",
      timestamp: "2026-01-01T00:00:00Z",
      command: "event.end",
      level: "L3",
      changes: [],
    });
    expect(checkMessage(message, index)).toEqual([]);
  });

  it("未知 id 被拒绝", () => {
    const message = log({
      operator: "tester",
      timestamp: "2026-01-01T00:00:00Z",
      command: "event.finish",
      changes: [],
    });
    expect(checkMessage(message, index).join("\n")).toContain("未知 command");
  });

  it("中文标题冒充 id 被拒绝", () => {
    const message = log({
      operator: "tester",
      timestamp: "2026-01-01T00:00:00Z",
      command: "撤回（删队 + 修改开赛时间）",
      changes: [],
    });
    expect(checkMessage(message, index).join("\n")).toContain("未知 command");
  });

  it("缺少 command 被拒绝", () => {
    const message = log({
      operator: "tester",
      timestamp: "2026-01-01T00:00:00Z",
      changes: [],
    });
    expect(checkMessage(message, index).join("\n")).toContain("缺少 command");
  });

  it("自报级别与契约不符被拒绝", () => {
    const message = log({
      operator: "tester",
      timestamp: "2026-01-01T00:00:00Z",
      command: "event.end",
      level: "L2",
      changes: [],
    });
    expect(checkMessage(message, index).join("\n")).toContain("级别是 L3");
  });

  it("没有日志块的提交跳过（结构校验归 validate-op-log）", () => {
    expect(checkMessage("chore: 普通提交", index)).toEqual([]);
  });
});
