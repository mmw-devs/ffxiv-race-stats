"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CompareAndSwapError,
  MutationLockBusyError,
  RuntimeRootError,
  TaskStore,
} = require("./task-store.js");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ops-base-task-store-"));
  const workspace = path.join(root, "workspace");
  const runtime = path.join(root, "runtime");
  await fs.mkdir(workspace);
  const store = new TaskStore({ workspaceRoot: workspace, runtimeRoot: runtime });
  await store.initialize();
  return {
    root,
    store,
    async cleanup() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

test("创建 task、保存 artifact 并以 CAS 更新 state", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);

  const created = await env.store.createTask({ operator: { feishuOpenId: "ou_test_operator" } });
  assert.match(created.taskId, /^opst_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(created.documentRevision, 1);
  assert.equal(created.lifecycle.state, "CREATED");

  const updated = await env.store.updateState(created.taskId, 1, (state) => {
    state.lifecycle.state = "AUTHORIZING";
    return state;
  });
  assert.equal(updated.documentRevision, 2);
  assert.equal(updated.lifecycle.stateVersion, 2);

  await assert.rejects(
    env.store.updateState(created.taskId, 1, (state) => state),
    CompareAndSwapError,
  );

  const baseline = await env.store.saveBaseline(created.taskId, 2, { teams: [] }, "sha256:fixture");
  assert.equal(baseline.state.documentRevision, 3);
  assert.equal(baseline.resource.locator.sourceSha256, "sha256:fixture");
  assert.equal(baseline.state.execution.baselineResourceId, "res_baseline_snapshot_1");
  await fs.access(path.join(env.store.taskDirectory(created.taskId), "artifacts", "baseline-data.json"));

  const report = await env.store.saveValidationReport(created.taskId, 3, { ok: true });
  assert.equal(report.state.validation.reportResourceId, "res_validation_report_1");
  const record = await env.store.saveChangeRecord(created.taskId, 4, { changes: [] });
  assert.equal(record.state.validation.changeRecordResourceId, "res_change_record_1");
});

test("并发创建只有一个 task 获得全局 mutation lock", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);

  const outcomes = await Promise.allSettled([
    env.store.createTask(),
    env.store.createTask(),
  ]);
  const successful = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const failed = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(successful.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].reason instanceof MutationLockBusyError);
  const owner = await env.store.readMutationLockOwner();
  assert.equal(owner.taskId, successful[0].value.taskId);
});

test("state 原子写在 rename 前中断时保留旧完整版本", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const created = await env.store.createTask();

  env.store.beforeStateRename = async () => {
    throw new Error("模拟进程在 rename 前中断");
  };
  await assert.rejects(
    env.store.updateState(created.taskId, 1, (state) => {
      state.lifecycle.state = "AUTHORIZING";
      return state;
    }),
    /模拟进程/,
  );
  env.store.beforeStateRename = undefined;

  const recovered = await env.store.readTask(created.taskId);
  assert.equal(recovered.documentRevision, 1);
  assert.equal(recovered.lifecycle.state, "CREATED");
  const taskFiles = await fs.readdir(env.store.taskDirectory(created.taskId));
  assert.equal(taskFiles.some((name) => name.includes(".state.json.") && name.endsWith(".tmp")), false);
});

test("重启扫描非 ENDED task 并恢复缺失的 mutation lock", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const created = await env.store.createTask();
  const ended = await env.store.createTask().catch(() => null);
  assert.equal(ended, null, "active task 存在时不能创建第二个 task");

  const restarted = new TaskStore({ workspaceRoot: path.join(env.root, "workspace"), runtimeRoot: path.join(env.root, "runtime") });
  await restarted.initialize();
  const active = await restarted.scanNonEndedTasks();
  assert.deepEqual(active.map((state) => state.taskId), [created.taskId]);
  assert.equal((await restarted.recoverActiveTask()).taskId, created.taskId);

  await restarted.releaseMutationLock(created.taskId);
  assert.equal((await restarted.readMutationLockOwner()), null);
  assert.equal((await restarted.recoverActiveTask()).taskId, created.taskId);
  assert.equal((await restarted.readMutationLockOwner()).taskId, created.taskId);
});

test("拒绝将 runtime-root 放入 Git workspace", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ops-base-root-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const store = new TaskStore({ workspaceRoot: workspace, runtimeRoot: path.join(workspace, ".runtime") });
  await assert.rejects(store.initialize(), RuntimeRootError);
});
