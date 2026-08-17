"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { generateUpdateTeamOpLog, validateUpdateTeamOpLog } = require("./update-team-op-log.js");
const before = { teams: [{ id: "t1", phase: "P3", bossHP: 50, isLive: true, region: "JP" }] };
const after = () => structuredClone(before);
const log = (changes) => ({ operator: "ou_allowed", timestamp: "2026-01-01T00:00:00.000Z", action: "updateTeam", target: "t1", changes });
const change = (field, from, to) => ({ field, from, to });
function validate(candidate, changes, operator = "ou_allowed") { const value = log(changes); value.operator = operator; return validateUpdateTeamOpLog({ log: value, baseline: before, candidate, allowlist: ["ou_allowed"] }); }

test("OP_LOG 只能从 validator actualChanges 生成", () => {
  const state = { operator: { feishuOpenId: "ou_allowed" }, operation: { action: "updateTeam", target: { id: "t1" } }, confirmations: { execution: { status: "CONFIRMED" } } };
  const output = generateUpdateTeamOpLog(state, { success: true, actualChanges: [{ path: "teams[id=t1].bossHP", from: 50, to: 40 }] }, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(output.changes, [change("teams[id=t1].bossHP", 50, 40)]);
});
test("OP_LOG 与实际 diff 不一致 hard fail", () => { const data = after(); data.teams[0].bossHP = 40; assert.equal(validate(data, [change("teams[id=t1].bossHP", 50, 35)]).success, false); });
test("未授权 operator hard fail", () => { const data = after(); data.teams[0].bossHP = 40; assert.ok(validate(data, [change("teams[id=t1].bossHP", 50, 40)], "ou_no").errors.some((e) => e.includes("allowlist"))); });
test("bossHP 增加 hard fail", () => { const data = after(); data.teams[0].bossHP = 60; assert.ok(validate(data, [change("teams[id=t1].bossHP", 50, 60)]).errors.some((e) => e.includes("bossHP"))); });
test("phase 后退 hard fail", () => { const data = after(); data.teams[0].phase = "P2"; assert.ok(validate(data, [change("teams[id=t1].phase", "P3", "P2")]).errors.some((e) => e.includes("phase"))); });
test("非允许字段 hard fail", () => { const data = after(); data.teams[0].region = "EU"; assert.ok(validate(data, []).errors.some((e) => e.includes("允许字段"))); });
