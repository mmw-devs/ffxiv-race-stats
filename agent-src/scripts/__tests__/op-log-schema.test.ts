// op-log-schema.test.ts — op-log-schema 模块单元测试
// 覆盖：常量、权限校验、日志生成、格式、解析、结构校验
import { describe, expect, it } from "vitest";

import {
  ACTION_RISK_LEVELS,
  ACTION_TYPES,
  OPERATOR_ALLOWLIST,
  formatCommitBlock,
  formatCommitMessage,
  generateLog,
  getActionRiskLevel,
  isActionAllowed,
  isOperatorAllowed,
  parseLogFromMessage,
  validateLogStructure,
  validateOperatorPermission,
} from "../op-log-schema.js";
import type { LogEntry } from "../types.js";

// ══════════════════════════════════════════════════════════════
// 常量完整性
// ══════════════════════════════════════════════════════════════

describe("常量导出", () => {
  it("OPERATOR_ALLOWLIST 至少包含一个操作人", () => {
    expect(OPERATOR_ALLOWLIST.length).toBeGreaterThan(0);
    expect(OPERATOR_ALLOWLIST).toContain("weunimix");
  });

  it("ACTION_TYPES 含6 种动作", () => {
    expect(ACTION_TYPES.length).toBe(6);
    expect(ACTION_TYPES).toEqual([
      "updateTeam",
      "addNews",
      "addBroadcaster",
      "updateBroadcaster",
      "deleteBroadcaster",
      "updateMeta",
    ]);
  });

  it("ACTION_RISK_LEVELS 覆盖所有 ACTION_TYPES", () => {
    for (const action of ACTION_TYPES) {
      expect(ACTION_RISK_LEVELS[action]).toBeDefined();
      expect(["high", "medium", "low"]).toContain(ACTION_RISK_LEVELS[action]);
    }
  });

  it("high 风险操作仅限不可逆或影响面大的动作", () => {
    expect(ACTION_RISK_LEVELS.deleteBroadcaster).toBe("high");
    expect(ACTION_RISK_LEVELS.updateMeta).toBe("high");
    // 增/改内容不应是 high
    expect(ACTION_RISK_LEVELS.addNews).not.toBe("high");
    expect(ACTION_RISK_LEVELS.addBroadcaster).not.toBe("high");
  });
});

// ══════════════════════════════════════════════════════════════
// isOperatorAllowed / isActionAllowed / getActionRiskLevel
// ══════════════════════════════════════════════════════════════

describe("isOperatorAllowed", () => {
  it("白名单内的 operator 通过", () => {
    expect(isOperatorAllowed("weunimix")).toBe(true);
  });

  it("白名单外的 operator 被拒", () => {
    expect(isOperatorAllowed("unknown")).toBe(false);
    expect(isOperatorAllowed("")).toBe(false);
  });
});

describe("isActionAllowed", () => {
  it("允许列表内的 action 通过", () => {
    expect(isActionAllowed("updateTeam")).toBe(true);
    expect(isActionAllowed("deleteBroadcaster")).toBe(true);
  });

  it("允许列表外的 action 被拒", () => {
    expect(isActionAllowed("unknownAction")).toBe(false);
    expect(isActionAllowed("")).toBe(false);
  });
});

describe("getActionRiskLevel", () => {
  it("已知 action 返回对应等级", () => {
    expect(getActionRiskLevel("deleteBroadcaster")).toBe("high");
    expect(getActionRiskLevel("updateTeam")).toBe("medium");
    expect(getActionRiskLevel("addNews")).toBe("low");
  });

  it("未知 action 默认 low", () => {
    expect(getActionRiskLevel("unknownAction")).toBe("low");
  });
});

// ══════════════════════════════════════════════════════════════
// validateOperatorPermission
// ══════════════════════════════════════════════════════════════

describe("validateOperatorPermission", () => {
  const validLog: LogEntry = {
    operator: "weunimix",
    timestamp: "2026-07-24T05:26:11Z",
    action: "updateTeam",
    target: "t1",
    changes: [{ field: "teams[0].bossHP", from: 15.0, to: 12.5 }],
  };

  it("合法组合返回 valid + 无错误", () => {
    const r = validateOperatorPermission(validLog);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.riskLevel).toBe("medium");
  });

  it("operator 不在白名单 → invalid", () => {
    const r = validateOperatorPermission({ ...validLog, operator: "hacker" });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("操作人");
    expect(r.errors[0]).toContain("hacker");
  });

  it("action 不在允许列表 → invalid", () => {
    const r = validateOperatorPermission({ ...validLog, action: "maliciousAction" });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("操作类型");
  });

  it("同时 operator + action 非法 → 2 个错误", () => {
    const r = validateOperatorPermission({ ...validLog, operator: "hacker", action: "x" });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBe(2);
  });

  it("返回的 riskLevel 来自 action", () => {
    expect(validateOperatorPermission({ ...validLog, action: "deleteBroadcaster" }).riskLevel).toBe("high");
    expect(validateOperatorPermission({ ...validLog, action: "addNews" }).riskLevel).toBe("low");
  });
});

// ══════════════════════════════════════════════════════════════
// generateLog
// ══════════════════════════════════════════════════════════════

describe("generateLog", () => {
  it("填入所有传入参数 + 自动 timestamp", () => {
    const log = generateLog("weunimix", "updateTeam", "t1", [
      { field: "teams[0].bossHP", from: 15.0, to: 12.5 },
    ]);
    expect(log.operator).toBe("weunimix");
    expect(log.action).toBe("updateTeam");
    expect(log.target).toBe("t1");
    expect(log.changes).toEqual([{ field: "teams[0].bossHP", from: 15.0, to: 12.5 }]);
    expect(log.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("timestamp 为 ISO 8601 可解析", () => {
    const log = generateLog("weunimix", "updateTeam", "t1", [
      { field: "x", from: 1, to: 2 },
    ]);
    const parsed = new Date(log.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// formatCommitBlock / formatCommitMessage
// ══════════════════════════════════════════════════════════════

describe("formatCommitBlock", () => {
  it("4 反引号包围 + JSON.stringify(log, null, 2)", () => {
    const log = generateLog("weunimix", "updateTeam", "t1", [
      { field: "teams[0].bossHP", from: 15.0, to: 12.5 },
    ]);
    const block = formatCommitBlock(log);
    expect(block.startsWith("````json\n")).toBe(true);
    expect(block.endsWith("\n````")).toBe(true);
    expect(block).toContain('"operator": "weunimix"');
  });

  it("生成的块可被 parseLogFromMessage 还原", () => {
    const log = generateLog("weunimix", "updateTeam", "t1", [
      { field: "teams[0].bossHP", from: 15.0, to: 12.5 },
    ]);
    const block = formatCommitBlock(log);
    const parsed = parseLogFromMessage(`content: x\n\n${block}`);
    expect(parsed).toEqual(log);
  });
});

describe("formatCommitMessage", () => {
  it("组装完整 commit message", () => {
    const log = generateLog("weunimix", "updateTeam", "t1", [
      { field: "x", from: 1, to: 2 },
    ]);
    const msg = formatCommitMessage("t1 bossHP 15.0→12.5", log);
    expect(msg.startsWith("content: t1 bossHP 15.0→12.5\n\n")).toBe(true);
    expect(msg).toContain("````json");
    expect(msg).toContain('"operator": "weunimix"');
  });
});

// ══════════════════════════════════════════════════════════════
// parseLogFromMessage
// ══════════════════════════════════════════════════════════════

describe("parseLogFromMessage", () => {
  const fullMsg = `content: t1 bossHP 15.0→12.5

\`\`\`\`json
{
  "operator": "weunimix",
  "timestamp": "2026-07-24T05:26:11Z",
  "action": "updateTeam",
  "target": "t1",
  "changes": [
    { "field": "teams[0].bossHP", "from": 15.0, "to": 12.5 }
  ]
}
\`\`\`\``;

  it("4 反引号 JSON 块可解析", () => {
    const parsed = parseLogFromMessage(fullMsg);
    expect(parsed).not.toBeNull();
    expect(parsed?.operator).toBe("weunimix");
    expect(parsed?.changes[0]?.field).toBe("teams[0].bossHP");
  });

  it("3 反引号 JSON 块也兼容", () => {
    const msg3 = fullMsg.replace(/`{4}/g, "```");
    const parsed = parseLogFromMessage(msg3);
    expect(parsed?.operator).toBe("weunimix");
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
});

// ══════════════════════════════════════════════════════════════
// validateLogStructure
// ══════════════════════════════════════════════════════════════

describe("validateLogStructure", () => {
  const baseLog = {
    operator: "weunimix",
    timestamp: "2026-07-24T05:26:11Z",
    action: "updateTeam",
    target: "t1",
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

  it("缺 action → invalid", () => {
    const { action: _omit, ...rest } = baseLog;
    const r = validateLogStructure(rest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("action"))).toBe(true);
  });

  it("缺 target → invalid", () => {
    const { target: _omit, ...rest } = baseLog;
    const r = validateLogStructure(rest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("target"))).toBe(true);
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
});