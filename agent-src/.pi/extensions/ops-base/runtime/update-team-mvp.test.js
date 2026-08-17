"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { LarkTaskRouter } = require("./lark-task-router.js");
const { TaskStore } = require("./task-store.js");
const { UpdateTeamMvp, UpdateTeamMvpError } = require("./update-team-mvp.js");
const { UpdateTeamValidator } = require("./update-team-validator.js");

const fixtureData = {
  meta: {},
  teams: [
    { id: "t1", name: "Alpha", rank: 1, phase: "P3", bossHP: 50, isLive: true, region: "JP", players: [] },
    { id: "t2", name: "Same", rank: 2, phase: "P2", bossHP: 80, isLive: true, region: "NA", players: [] },
    { id: "t3", name: "Same", rank: 3, phase: "P1", bossHP: 90, isLive: false, region: "EU", players: [] },
  ],
};

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ops-base-update-team-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(path.join(workspace, "public"), { recursive: true });
  await fs.writeFile(path.join(workspace, "public", "data.json"), `${JSON.stringify(fixtureData, null, 2)}\n`);
  const store = new TaskStore({ workspaceRoot: workspace, runtimeRoot: path.join(root, "runtime") });
  await store.initialize();
  const router = new LarkTaskRouter(store);
  const routed = await router.route({
    chatId: "oc_update_team",
    chatType: "p2p",
    feishuOpenId: "ou_owner",
    triggerMessageId: "om_create",
    threadId: null,
    rootMessageId: null,
    text: "更新 t1",
  });
  await store.activateIngress(routed.state.taskId, "om_create");
  const trusted = { taskId: routed.state.taskId, feishuOpenId: "ou_owner", messageId: "om_create" };
  return {
    root,
    store,
    router,
    trusted,
    update: new UpdateTeamMvp({ taskStore: store, workspaceRoot: workspace, allowedOperators: ["ou_owner"] }),
    async cleanup() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof UpdateTeamMvpError && error.code === code);
}

test("正常 bossHP 修改生成计划和 candidate，绝不写 data.json", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const before = await fs.readFile(path.join(env.root, "workspace", "public", "data.json"), "utf8");

  const planned = await env.update.plan(env.trusted, { teamId: "t1", bossHP: 40 });
  assert.equal(planned.state.lifecycle.state, "AWAITING_CONFIRMATION");
  assert.deepEqual(planned.state.operator.permissions.permissionSet, ["race.updateTeam"]);
  assert.deepEqual(planned.plan.plannedChanges, [{ path: "teams[id=t1].bossHP", from: 50, to: 40, source: "OPERATOR" }]);
  assert.equal(planned.plan.baselineResourceId, "res_baseline_snapshot_1");
  const baseline = await env.store.readBaseline(env.trusted.taskId);
  assert.equal(baseline.resource.locator.sourceSha256, planned.plan.baselineDataSha256);
  assert.deepEqual(baseline.baseline, fixtureData, "首次计划必须固化原始 baseline snapshot");

  const candidate = await env.update.confirm(env.trusted, {
    feishuOpenId: "ou_owner",
    messageId: "om_create",
    planHash: planned.plan.planHash,
  });
  assert.equal(candidate.state.lifecycle.state, "EXECUTING");
  assert.ok(candidate.candidateResourceId);
  const after = await fs.readFile(path.join(env.root, "workspace", "public", "data.json"), "utf8");
  assert.equal(after, before, "D3 不得写入真实 data.json");
  const resource = candidate.state.resources.items.find((item) => item.resourceId === candidate.candidateResourceId);
  const artifact = JSON.parse(await fs.readFile(path.join(env.store.taskDirectory(env.trusted.taskId), ...resource.locator.path.split("/")), "utf8"));
  assert.equal(artifact.teams.find((team) => team.id === "t1").bossHP, 40);
});

test("validator 失败后恢复 baseline candidate 且不进入可提交状态", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const planned = await env.update.plan(env.trusted, { teamId: "t1", bossHP: 40 });
  const confirmed = await env.update.confirm(env.trusted, {
    feishuOpenId: "ou_owner", messageId: "om_create", planHash: planned.plan.planHash,
  });
  const candidateResource = confirmed.state.resources.items.find((item) => item.resourceId === confirmed.candidateResourceId);
  const candidatePath = path.join(env.store.taskDirectory(env.trusted.taskId), ...candidateResource.locator.path.split("/"));
  const malicious = JSON.parse(await fs.readFile(candidatePath, "utf8"));
  malicious.teams[0].region = "EU";
  await fs.writeFile(candidatePath, JSON.stringify(malicious));
  const result = await new UpdateTeamValidator({ taskStore: env.store }).validate(env.trusted.taskId);
  assert.equal(result.report.success, false);
  assert.equal(result.state.lifecycle.state, "VALIDATION_FAILED");
  const restored = await env.store.readCandidateData(env.trusted.taskId);
  assert.deepEqual(restored.candidate, fixtureData);
});

test("baseline 变化会拒绝确认且保持 AWAITING_CONFIRMATION", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const planned = await env.update.plan(env.trusted, { teamId: "t1", bossHP: 40 });
  const changed = structuredClone(fixtureData);
  changed.teams[0].bossHP = 49;
  await fs.writeFile(path.join(env.root, "workspace", "public", "data.json"), JSON.stringify(changed));
  await expectCode(env.update.confirm(env.trusted, {
    feishuOpenId: "ou_owner", messageId: "om_create", planHash: planned.plan.planHash,
  }), "BASELINE_CHANGED");
  const state = await env.store.readTask(env.trusted.taskId);
  assert.equal(state.lifecycle.state, "AWAITING_CONFIRMATION");
  assert.equal(state.confirmations?.execution, undefined);
  assert.equal(state.execution.candidateResourceId, undefined);
});

test("未列入 allowlist 的完整 openId 不得规划", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  env.update.allowedOperators.clear();
  await expectCode(env.update.plan(env.trusted, { teamId: "t1", bossHP: 40 }), "AUTHORIZATION_DENIED");
  assert.equal((await env.store.readTask(env.trusted.taskId)).lifecycle.state, "CREATED");
});

test("信息不足、队伍歧义和不存在均不会生成计划", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  await expectCode(env.update.plan(env.trusted, { bossHP: 40 }), "MISSING_INFORMATION");
  await expectCode(env.update.plan(env.trusted, { teamName: "Same", bossHP: 40 }), "TEAM_AMBIGUOUS");
  await expectCode(env.update.plan(env.trusted, { teamId: "missing", bossHP: 40 }), "TEAM_NOT_FOUND");
});

test("非法字段、P5 和 FINAL 被 Runtime 拒绝", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  await expectCode(env.update.plan(env.trusted, { teamId: "t1", rank: 2 }), "UNSUPPORTED_FIELD");
  await expectCode(env.update.plan(env.trusted, { teamId: "t1", phase: "P5" }), "INVALID_PHASE");
  await expectCode(env.update.plan(env.trusted, { teamId: "t1", phase: "FINAL" }), "INVALID_PHASE");
});

test("非 owner 和旧 planHash 不能确认", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const first = await env.update.plan(env.trusted, { teamId: "t1", bossHP: 45 });
  await expectCode(env.update.confirm(env.trusted, {
    feishuOpenId: "ou_other",
    messageId: "om_create",
    planHash: first.plan.planHash,
  }), "CONFIRMATION_OPERATOR_MISMATCH");

  // 新可信 follow-up 重新规划，旧 planHash 必须失效。
  const followUp = await env.router.route({
    chatId: "oc_update_team", chatType: "p2p", feishuOpenId: "ou_owner",
    triggerMessageId: "om_replan", threadId: null, rootMessageId: null, text: "改为 40",
  });
  await env.store.activateIngress(followUp.state.taskId, "om_replan");
  const latestTrusted = { taskId: followUp.state.taskId, feishuOpenId: "ou_owner", messageId: "om_replan" };
  const second = await env.update.plan(latestTrusted, { teamId: "t1", bossHP: 40 });
  await expectCode(env.update.confirm(latestTrusted, {
    feishuOpenId: "ou_owner",
    messageId: "om_replan",
    planHash: first.plan.planHash,
  }), "STALE_PLAN_CONFIRMATION");
  assert.notEqual(second.plan.planHash, first.plan.planHash);
});

test("phase 后退和未明确 isLive 的自动变更被拒绝/省略", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  await expectCode(env.update.plan(env.trusted, { teamId: "t1", phase: "P2" }), "PHASE_REGRESSION");
  const planned = await env.update.plan(env.trusted, { teamId: "t1", phase: "CLEAR", bossHP: 0 });
  assert.deepEqual(planned.plan.requestedFields.map((field) => field.path), ["teams[id=t1].phase", "teams[id=t1].bossHP"]);
  assert.equal(planned.plan.plannedChanges.some((change) => change.path.endsWith(".isLive")), false);
});
