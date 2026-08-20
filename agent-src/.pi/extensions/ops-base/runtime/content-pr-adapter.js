"use strict";

/** D5：只提交已验证事实，不解释用户文本、不修改 data.json。 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { validateUpdateTeam } = require("./update-team-validator.js");
const { generateUpdateTeamOpLog } = require("../../../../scripts/update-team-op-log.js");
const { formatCommitMessage } = require("../../../../scripts/op-log-schema.js");

class ContentPrAdapterError extends Error { constructor(code, message) { super(message); this.code = code; } }
function sameChanges(left, right) {
  const normalize = (items) => items.map(({ path, field, from, to }) => ({ path: path || field, from, to })).sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
function branchName(taskId, target) {
  return `content/update-${String(target).replace(/[^A-Za-z0-9-]/g, "-").slice(0, 8)}-${taskId.slice(-6).toLowerCase()}`;
}

class ContentPrAdapter {
  constructor({ taskStore, workspaceRoot, run = (file, args) => execFileSync(file, args, { cwd: workspaceRoot, encoding: "utf8" }) }) {
    this.taskStore = taskStore;
    this.workspaceRoot = workspaceRoot;
    this.run = run;
  }

  async submit(taskId) {
    let state = await this.taskStore.readTask(taskId);
    if (state.submission?.prUrl || state.submission?.status === "PR_CREATED" || state.control?.pendingEffect?.kind === "CREATE_PR") {
      throw new ContentPrAdapterError("PR_ALREADY_CREATED", "同一 task 不允许创建第二个 PR");
    }
    if (state.lifecycle.state !== "VALIDATED" || state.operation?.action !== "updateTeam") {
      throw new ContentPrAdapterError("SUBMISSION_NOT_VALIDATED", "只有 VALIDATED 的 updateTeam task 可以创建 PR");
    }
    if (!state.execution?.workspaceCandidateSha256) {
      throw new ContentPrAdapterError("CANDIDATE_NOT_APPLIED", "必须先通过 WorkspaceCandidateApplier 显式应用已验证 candidate");
    }
    const currentBranch = String(this.run("git", ["branch", "--show-current"]) || "").trim();
    const dirtyPaths = String(this.run("git", ["status", "--porcelain"]) || "").split("\n").filter(Boolean).map((line) => line.slice(3).trim());
    if (currentBranch !== "main" || dirtyPaths.some((file) => file !== "public/data.json")) {
      throw new ContentPrAdapterError("WORKSPACE_NOT_FIXED_BASE", "提交前 workspace 必须位于干净 main（仅允许已应用的 public/data.json）");
    }
    const record = await this.taskStore.readResourceJson(taskId, state.validation.changeRecordResourceId);
    const baseline = await this.taskStore.readBaseline(taskId);
    const workspaceData = JSON.parse(await fs.readFile(path.join(this.workspaceRoot, "public", "data.json"), "utf8"));
    const independent = validateUpdateTeam({ baseline: baseline.baseline, candidate: workspaceData, plan: state.operation });
    if (!independent.success || !sameChanges(independent.actualChanges, record.payload.actualChanges)) {
      throw new ContentPrAdapterError("WORKSPACE_DIFF_MISMATCH", "workspace 实际 diff 与已验证 change record 不一致，拒绝提交");
    }
    // OP_LOG 只消费 validator 的 change-record，绝不读取或信任 Agent/validation report 自述 changes。
    const opLog = generateUpdateTeamOpLog(state, { success: true, actualChanges: record.payload.actualChanges });
    const branch = branchName(taskId, state.operation.target.id);
    state = await this.taskStore.transitionState(taskId, state.documentRevision, "SUBMITTING", (draft) => {
      draft.control.pendingEffect = { kind: "CREATE_PR", idempotencyKey: `submit:${taskId}:${draft.lifecycle.attempt}`, branch, status: "INTENT_RECORDED" };
      return draft;
    });
    // 此 adapter 只消费 workspace 已有事实；没有 writeFile、patch 或 data.json 修改命令。
    this.run("git", ["checkout", "-b", branch]);
    state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => { draft.control.pendingEffect.stage = "BRANCH_CREATED"; return draft; });
    this.run("git", ["add", "public/data.json"]);
    this.run("git", ["commit", "-m", formatCommitMessage(`update ${state.operation.target.id}`, opLog)]);
    state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => { draft.control.pendingEffect.stage = "COMMITTED"; return draft; });
    this.run("git", ["push", "-u", "origin", branch]);
    state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => { draft.control.pendingEffect.stage = "PUSHED"; return draft; });
    const prUrl = String(this.run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", `content: update ${state.operation.target.id}`, "--body", "由 ops-base validator 创建"]) || "").trim();
    if (!prUrl) throw new ContentPrAdapterError("PR_RESULT_UNKNOWN", "创建 PR 未返回 URL，保留 pendingEffect 供对账");
    const created = await this.taskStore.transitionState(taskId, state.documentRevision, "PR_CREATED", (draft) => {
      draft.submission = { status: "PR_CREATED", branch, prUrl, opLog, createdAt: new Date().toISOString() };
      draft.control.pendingEffect = null;
      return draft;
    });
    return { state: created, branch, prUrl, opLog };
  }
}
module.exports = { ContentPrAdapter, ContentPrAdapterError, branchName };
