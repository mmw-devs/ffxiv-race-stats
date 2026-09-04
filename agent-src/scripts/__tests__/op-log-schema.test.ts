// op-log-schema.test.ts — op-log-schema 模块单元测试
// 覆盖：常量、权限校验、日志生成、格式、解析、结构校验
//
// PR #2 起：
//   - 删 ACTION_TYPES / ACTION_RISK_LEVELS / target 字段
//   - OPERATOR_ALLOWLIST 字符串数组 → OPERATOR_REGISTRY（user_id → {name}）
//   - generateLog(operator, changes) 3 字段版本
import { describe, expect, it } from "vitest";

import {
  OPERATOR_REGISTRY,
  formatCommitBlock,
  formatCommitMessage,
  generateLog,
  getOperatorName,
  isOperatorAllowed,
  parseLogFromMessage,
  validateLogStructure,
  validateOperatorPermission,
} from "../op-log-schema.js";
import type { LogEntry } from "../types.js";

// ══════════════════════════════════════════════════════════════
// 常量完整性
// ══════════════════════════════════════════════════════════════

describe("OPERATOR_REGISTRY 常量导出", () => {
  it("至少包含一个运营者", () => {
    expect(Object.keys(OPERATOR_REGISTRY).length).toBeGreaterThan(0);
  });

  it("key 为飞书 user_id 字符串", () => {
    for (const key of Object.keys(OPERATOR_REGISTRY)) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("value 为 { name: string } 形式", () => {
    for (const entry of Object.values(OPERATOR_REGISTRY)) {
      expect(entry).toHaveProperty("name");
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("示例运营者 weunimix / 赤墓 均存在（user_id 形式））", () => {
    expect(OPERATOR_REGISTRY["38a32652"]?.name).toBe("weunimix");
    expect(OPERATOR_REGISTRY["311a2ea5"]?.name).toBe("赤墓");
  });
});

// ══════════════════════════════════════════════════════════════
// isOperatorAllowed / getOperatorName
// ══════════════════════════════════════════════════════════════

describe("isOperatorAllowed", () => {
  it("注册表内的 user_id 通过", () => {
    expect(isOperatorAllowed("38a32652")).toBe(true);
    expect(isOperatorAllowed("311a2ea5")).toBe(true);
  });

  it("未注册的 user_id 被拒", () => {
    expect(isOperatorAllowed("unknown_user_id")).toBe(false);
    expect(isOperatorAllowed("")).toBe(false);
    expect(isOperatorAllowed("weunimix")).toBe(false); // 字符串 user_id，不是展示名
  });

  it("Object.prototype 字段不会被误判为 user_id", () => {
    expect(isOperatorAllowed("__proto__")).toBe(false);
    expect(isOperatorAllowed("constructor")).toBe(false);
    expect(isOperatorAllowed("toString")).toBe(false);
  });
});

describe("getOperatorName", () => {
  it("注册表内 user_id 返回展示名", () => {
    expect(getOperatorName("38a32652")).toBe("weunimix");
    expect(getOperatorName("311a2ea5")).toBe("赤墓");
  });

  it("未注册的 user_id 返回 null", () => {
    expect(getOperatorName("unknown")).toBeNull();
    expect(getOperatorName("")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// validateOperatorPermission
// ══════════════════════════════════════════════════════════════

describe("validateOperatorPermission", () => {
  const validLog: LogEntry = {
    operator: "38a32652",
    timestamp: "2026-07-24T05:26:11Z",
    changes: [{ field: "teams[0].bossHP", from: 15.0, to: 12.5 }],
  };

  it("注册表内的 operator 返回 valid + 无错误", () => {
    const r = validateOperatorPermission(validLog);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("未注册的 operator 返回 invalid", () => {
    const r = validateOperatorPermission({ ...validLog, operator: "hacker_id" });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("操作人");
    expect(r.errors[0]).toContain("hacker_id");
  });

  it("operator 为空字符串被拒", () => {
    const r = validateOperatorPermission({ ...validLog, operator: "" });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("注册表");
  });
});

// ══════════════════════════════════════════════════════════════
// generateLog
// ══════════════════════════════════════════════════════════════

describe("generateLog", () => {
  it("3 字段签名：填入 operator + 自动 timestamp", () => {
    const log = generateLog("38a32652", [{ field: "teams[0].bossHP", from: 15.0, to: 12.5 }]);
    expect(log.operator).toBe("38a32652");
    expect(log.changes).toEqual([{ field: "teams[0].bossHP", from: 15.0, to: 12.5 }]);
    expect(log.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(log).not.toHaveProperty("action");
    expect(log).not.toHaveProperty("target");
  });

  it("timestamp 为 ISO 8601 可解析", () => {
    const log = generateLog("38a32652", [{ field: "x", from: 1, to: 2 }]);
    const parsed = new Date(log.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it("operator 是字符串（user_id 形式，不是展示名）", () => {
    const log = generateLog("311a2ea5", [{ field: "x", from: 1, to: 2 }]);
    expect(log.operator).toBe("311a2ea5");
    expect(log.operator).not.toBe("赤墓");
  });
});

// ══════════════════════════════════════════════════════════════
// formatCommitBlock / formatCommitMessage
// ══════════════════════════════════════════════════════════════

describe("formatCommitBlock", () => {
  it("4 反引号包围 + JSON.stringify(log, null, 2)", () => {
    const log = generateLog("38a32652", [{ field: "teams[0].bossHP", from: 15.0, to: 12.5 }]);
    const block = formatCommitBlock(log);
    expect(block.startsWith("````json\n")).toBe(true);
    expect(block.endsWith("\n````")).toBe(true);
    expect(block).toContain('"operator": "38a32652"');
  });

  it("生成的块可被 parseLogFromMessage 还原", () => {
    const log = generateLog("38a32652", [{ field: "teams[0].bossHP", from: 15.0, to: 12.5 }]);
    const block = formatCommitBlock(log);
    const parsed = parseLogFromMessage(`content: x\n\n${block}`);
    expect(parsed).toEqual(log);
  });
});

describe("formatCommitMessage", () => {
  it("组装完整 commit message", () => {
    const log = generateLog("38a32652", [{ field: "x", from: 1, to: 2 }]);
    const msg = formatCommitMessage("t1 bossHP 15.0→12.5", log);
    expect(msg.startsWith("content: t1 bossHP 15.0→12.5\n\n")).toBe(true);
    expect(msg).toContain("````json");
    expect(msg).toContain('"operator": "38a32652"');
  });
});

// ══════════════════════════════════════════════════════════════
// parseLogFromMessage
// ══════════════════════════════════════════════════════════════

describe("parseLogFromMessage", () => {
  const fullMsg = `content: t1 bossHP 15.0→12.5

\`\`\`\`json
{
  "operator": "38a32652",
  "timestamp": "2026-07-24T05:26:11Z",
  "changes": [
    { "field": "teams[0].bossHP", "from": 15.0, "to": 12.5 }
  ]
}
\`\`\`\``;

  it("4 反引号 JSON 块可解析", () => {
    const parsed = parseLogFromMessage(fullMsg);
    expect(parsed).not.toBeNull();
    expect(parsed?.operator).toBe("38a32652");
    expect(parsed?.changes[0]?.field).toBe("teams[0].bossHP");
  });

  it("3 反引号 JSON 块也兼容", () => {
    const msg3 = fullMsg.replace(/`{4}/g, "```");
    const parsed = parseLogFromMessage(msg3);
    expect(parsed?.operator).toBe("38a32652");
  });

  it("无 JSON 块返回 null", () => {
    expect(parseLogFromMessage("content: just a commit")).toBeNull();
  });

  it("JSON 格式非法返回 null", () => {
    const bad = "````json\n{ not valid json }\n````";
    expect(parseLogFromMessage(bad)).toBeNull();
  });

  it("空字符串返回 null", () => {
    expect(parseLogFromMessage("")).toBeNull();
  });

  it("PR #2 起：旧 5 字段日志（含 action/target）应仍可解析（结构校验阶段拒绝）", () => {
    // 兼容性测试：PR #2 边界期间可能混用旧 5 字段日志，
    // parseLogFromMessage 只解析 JSON 不强制字段，后续 validateLogStructure 决定合法性
    const oldFormat = `\`\`\`\`json
{
  "operator": "38a32652",
  "timestamp": "2026-07-24T05:26:11Z",
  "action": "updateTeam",
  "target": "t1",
  "changes": [{ "field": "x", "from": 1, "to": 2 }]
}
\`\`\`\``;
    const parsed = parseLogFromMessage(oldFormat);
    expect(parsed?.operator).toBe("38a32652");
    // 旧字段仍能取出，但类型断言为 LogEntry（不含 action/target），TS 类型上忽略
  });
});

// ══════════════════════════════════════════════════════════════
// validateLogStructure
// ══════════════════════════════════════════════════════════════

describe("validateLogStructure", () => {
  const baseLog = {
    operator: "38a32652",
    timestamp: "2026-07-24T05:26:11Z",
    changes: [{ field: "x", from: 1, to: 2 }],
  };

  it("合法日志返回 valid + 无错误", () => {
    const r = validateLogStructure(baseLog);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("null 输入 invalid", () => {
    const r = validateLogStructure(null);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("不是对象");
  });

  it("缺 operator → invalid", () => {
    const { operator: _omit, ...rest } = baseLog;
    const r = validateLogStructure(rest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("operator"))).toBe(true);
  });

  it("缺 timestamp → invalid", () => {
    const { timestamp: _omit, ...rest } = baseLog;
    const r = validateLogStructure(rest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("timestamp"))).toBe(true);
  });

  it("缺 changes → invalid", () => {
    const { changes: _omit, ...rest } = baseLog;
    const r = validateLogStructure(rest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("changes"))).toBe(true);
  });

  it("changes 为空数组 → invalid", () => {
    const r = validateLogStructure({ ...baseLog, changes: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("changes 不能为空"))).toBe(true);
  });

  it("changes 项缺 field → invalid", () => {
    const r = validateLogStructure({
      ...baseLog,
      changes: [{ from: 1, to: 2 }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("field"))).toBe(true);
  });

  it("changes 项缺 from → invalid", () => {
    const r = validateLogStructure({
      ...baseLog,
      changes: [{ field: "x", to: 2 }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("from"))).toBe(true);
  });

  it("changes 项缺 to → invalid", () => {
    const r = validateLogStructure({
      ...baseLog,
      changes: [{ field: "x", from: 1 }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("to"))).toBe(true);
  });

  it("timestamp 非 ISO 8601 → invalid", () => {
    const r = validateLogStructure({ ...baseLog, timestamp: "not-a-date" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("无法解析"))).toBe(true);
  });

  it("operator 类型非字符串 → invalid", () => {
    const r = validateLogStructure({ ...baseLog, operator: 123 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("operator"))).toBe(true);
  });

  it("PR #2 起：action 字段非必需（多余的 action 不影响校验）", () => {
    // 旧 5 字段日志若保留 action 字段，validateLogStructure 不应拒绝（PR #2 仅校验 3 必填）
    const withExtraAction = { ...baseLog, action: "legacyAction", target: "legacyTarget" };
    const r = validateLogStructure(withExtraAction);
    expect(r.valid).toBe(true);
  });
});