"use strict";

/** 将已验证 candidate artifact 显式应用到共享 workspace；不创建 branch/commit/PR。 */
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { validateUpdateTeam } = require("./update-team-validator.js");

class WorkspaceCandidateApplierError extends Error { constructor(code, message) { super(message); this.code = code; } }
const hash = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const sameChanges = (left, right) => JSON.stringify(left.map(({ path, from, to }) => ({ path, from, to })).sort((a, b) => a.path.localeCompare(b.path))) === JSON.stringify(right.map(({ path, from, to }) => ({ path, from, to })).sort((a, b) => a.path.localeCompare(b.path)));

class WorkspaceCandidateApplier {
  constructor({ taskStore, workspaceRoot }) { this.taskStore = taskStore; this.workspaceRoot = workspaceRoot; }
  async apply(taskId) {
    let state = await this.taskStore.readTask(taskId);
    if (state.lifecycle.state !== "VALIDATED") throw new WorkspaceCandidateApplierError("APPLY_NOT_VALIDATED", "只有 VALIDATED task 可以应用 candidate");
    if (state.execution?.workspaceCandidateSha256) return { state, idempotent: true };
    const baseline = await this.taskStore.readBaseline(taskId);
    const candidate = await this.taskStore.readCandidateData(taskId);
    const record = await this.taskStore.readResourceJson(taskId, state.validation.changeRecordResourceId);
    const check = validateUpdateTeam({ baseline: baseline.baseline, candidate: candidate.candidate, plan: state.operation });
    if (!check.success || !sameChanges(check.actualChanges, record.payload.actualChanges || [])) throw new WorkspaceCandidateApplierError("CANDIDATE_RECORD_MISMATCH", "candidate 与 validation change record 不一致");
    const target = path.join(this.workspaceRoot, "public", "data.json");
    const current = JSON.parse(await fs.readFile(target, "utf8"));
    if (JSON.stringify(current) !== JSON.stringify(baseline.baseline)) throw new WorkspaceCandidateApplierError("WORKSPACE_BASELINE_MISMATCH", "共享 workspace 不等于固定 baseline，拒绝覆盖");
    state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => {
      draft.control.pendingEffect = { kind: "APPLY_CANDIDATE", stage: "INTENT_RECORDED", candidateResourceId: candidate.resource.resourceId };
      return draft;
    });
    const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(candidate.candidate, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, target);
    const applied = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => {
      draft.execution.workspaceCandidateSha256 = hash(candidate.candidate);
      draft.control.pendingEffect = { ...draft.control.pendingEffect, stage: "DATA_WRITTEN" };
      return draft;
    });
    const completed = await this.taskStore.updateState(taskId, applied.documentRevision, (draft) => {
      draft.control.pendingEffect = null;
      return draft;
    });
    return { state: completed, idempotent: false };
  }
}
module.exports = { WorkspaceCandidateApplier, WorkspaceCandidateApplierError };
