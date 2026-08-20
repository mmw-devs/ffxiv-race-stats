"use strict";

/** 共享 cwd MVP：先从固定 main 创建 task-owned content branch，之后才可写 candidate。 */
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { validateUpdateTeam } = require("./update-team-validator.js");

class WorkspaceCandidateApplierError extends Error { constructor(code, message) { super(message); this.code = code; } }
const hash = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const sameChanges = (left, right) => JSON.stringify(left.map(({ path, from, to }) => ({ path, from, to })).sort((a, b) => a.path.localeCompare(b.path))) === JSON.stringify(right.map(({ path, from, to }) => ({ path, from, to })).sort((a, b) => a.path.localeCompare(b.path)));
const branchName = (taskId, target) => `content/update-${String(target).replace(/[^A-Za-z0-9-]/g, "-").slice(0, 8)}-${taskId.slice(-6).toLowerCase()}`;

class WorkspaceCandidateApplier {
  constructor({ taskStore, workspaceRoot, run = (file, args) => execFileSync(file, args, { cwd: workspaceRoot, encoding: "utf8" }), beforeWrite, afterWrite }) {
    this.taskStore = taskStore; this.workspaceRoot = workspaceRoot; this.run = run; this.beforeWrite = beforeWrite; this.afterWrite = afterWrite;
  }
  async apply(taskId) {
    let state = await this.taskStore.readTask(taskId);
    if (state.lifecycle.state !== "VALIDATED") throw new WorkspaceCandidateApplierError("APPLY_NOT_VALIDATED", "只有 VALIDATED task 可以应用 candidate");
    if (state.confirmations?.execution?.boundPlanHash !== state.operation?.planHash) throw new WorkspaceCandidateApplierError("PLAN_HASH_MISMATCH", "已确认 planHash 与当前 operation 不匹配");
    if (state.execution?.workspaceCandidateSha256) return { state, idempotent: true };
    const baseline = await this.taskStore.readBaseline(taskId);
    if (state.operation?.baselineDataSha256 !== baseline.resource.locator.sourceSha256) throw new WorkspaceCandidateApplierError("BASELINE_HASH_MISMATCH", "operation baseline hash 与 snapshot 不一致");
    const candidate = await this.taskStore.readCandidateData(taskId);
    const record = await this.taskStore.readResourceJson(taskId, state.validation.changeRecordResourceId);
    const check = validateUpdateTeam({ baseline: baseline.baseline, candidate: candidate.candidate, plan: state.operation });
    if (!check.success || !sameChanges(check.actualChanges, record.payload.actualChanges || [])) throw new WorkspaceCandidateApplierError("CANDIDATE_RECORD_MISMATCH", "candidate 与 validation change record 不一致");

    const target = path.join(this.workspaceRoot, "public", "data.json");
    const current = JSON.parse(await fs.readFile(target, "utf8"));
    const branch = state.submission?.branch || branchName(taskId, state.operation.target.id);
    if (!state.submission?.branch) {
      const currentBranch = String(this.run("git", ["branch", "--show-current"]) || "").trim();
      const dirty = String(this.run("git", ["status", "--porcelain"]) || "").trim();
      if (currentBranch !== "main" || dirty) throw new WorkspaceCandidateApplierError("WORKSPACE_NOT_FIXED_BASE", "创建 branch 前 workspace 必须是干净 main");
      if (JSON.stringify(current) !== JSON.stringify(baseline.baseline)) throw new WorkspaceCandidateApplierError("WORKSPACE_BASELINE_MISMATCH", "共享 workspace 不等于固定 baseline，拒绝创建 branch");
      state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => { draft.control.pendingEffect = { kind: "CREATE_CONTENT_BRANCH", stage: "INTENT_RECORDED", branch }; return draft; });
      this.run("git", ["checkout", "-b", branch]);
      state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => {
        draft.submission = { status: "BRANCH_CREATED", branch, createdAt: new Date().toISOString() };
        draft.control.pendingEffect = { kind: "CREATE_CONTENT_BRANCH", stage: "BRANCH_CREATED", branch };
        return draft;
      });
    }
    if (JSON.stringify(current) !== JSON.stringify(baseline.baseline)) throw new WorkspaceCandidateApplierError("WORKSPACE_BASELINE_MISMATCH", "共享 workspace 不等于固定 baseline，拒绝覆盖");
    state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => { draft.control.pendingEffect = { kind: "APPLY_CANDIDATE", stage: "INTENT_RECORDED", candidateResourceId: candidate.resource.resourceId, branch }; return draft; });
    if (this.beforeWrite) await this.beforeWrite(state);
    const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(candidate.candidate, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, target);
    if (this.afterWrite) await this.afterWrite(state);
    const applied = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => { draft.execution.workspaceCandidateSha256 = hash(candidate.candidate); draft.control.pendingEffect = { ...draft.control.pendingEffect, stage: "DATA_WRITTEN" }; return draft; });
    const completed = await this.taskStore.updateState(taskId, applied.documentRevision, (draft) => { draft.control.pendingEffect = null; return draft; });
    return { state: completed, branch, idempotent: false };
  }
}
module.exports = { WorkspaceCandidateApplier, WorkspaceCandidateApplierError, branchName };
