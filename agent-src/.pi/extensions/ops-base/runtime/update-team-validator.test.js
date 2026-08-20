"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { validateUpdateTeam } = require("./update-team-validator.js");

const baseline = { meta: { status: "live" }, teams: [
  { id: "t1", name: "Alpha", phase: "P3", bossHP: 50, isLive: true, region: "JP", players: [] },
  { id: "t2", name: "Beta", phase: "P2", bossHP: 80, isLive: true, region: "NA", players: [] },
] };
function candidate() { return structuredClone(baseline); }
function plan(changes) { return { action: "updateTeam", target: { type: "team", id: "t1" }, plannedChanges: changes }; }
function change(path, from, to) { return { path, from, to, source: "OPERATOR" }; }

test("正常变化通过并返回 actualChanges", () => {
  const data = candidate(); data.teams[0].bossHP = 40;
  const result = validateUpdateTeam({ baseline, candidate: data, plan: plan([change("teams[id=t1].bossHP", 50, 40)]) });
  assert.equal(result.success, true);
  assert.deepEqual(result.actualChanges, [{ path: "teams[id=t1].bossHP", from: 50, to: 40, source: "ACTUAL" }]);
});

test("bossHP 增加失败", () => {
  const data = candidate(); data.teams[0].bossHP = 60;
  const result = validateUpdateTeam({ baseline, candidate: data, plan: plan([change("teams[id=t1].bossHP", 50, 60)]) });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((item) => item.code === "BOSS_HP_REGRESSION"));
});

test("phase 后退失败", () => {
  const data = candidate(); data.teams[0].phase = "P2";
  const result = validateUpdateTeam({ baseline, candidate: data, plan: plan([change("teams[id=t1].phase", "P3", "P2")]) });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((item) => item.code === "PHASE_REGRESSION"));
});

test("修改其他字段失败", () => {
  const data = candidate(); data.teams[0].region = "EU";
  const result = validateUpdateTeam({ baseline, candidate: data, plan: plan([]) });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((item) => item.code === "UNSUPPORTED_FIELD_CHANGE"));
});

test("teams 重排失败", () => {
  const data = candidate(); data.teams.reverse();
  const result = validateUpdateTeam({ baseline, candidate: data, plan: plan([]) });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((item) => item.code === "TEAM_ORDER_CHANGED"));
});

test("实际 diff 与 plan 不一致失败", () => {
  const data = candidate(); data.teams[0].bossHP = 40;
  const result = validateUpdateTeam({ baseline, candidate: data, plan: plan([change("teams[id=t1].bossHP", 50, 35)]) });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((item) => item.code === "PLAN_DIFF_MISMATCH"));
});
