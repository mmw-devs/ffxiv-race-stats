"use strict";

/** 启动期只对 CREATE_PR 做只读对账；绝不重试 push/create。 */
const { execFileSync } = require("node:child_process");

class ContentPrRecovery {
  constructor({ taskStore, workspaceRoot, run = (file, args) => execFileSync(file, args, { cwd: workspaceRoot, encoding: "utf8" }) }) {
    this.taskStore = taskStore; this.workspaceRoot = workspaceRoot; this.run = run;
  }
  async recoverAll() {
    const tasks = await this.taskStore.scanNonEndedTasks();
    return Promise.all(tasks.map((state) => this.recoverTask(state.taskId)));
  }
  async recoverTask(taskId) {
    let state = await this.taskStore.readTask(taskId);
    const effect = state.control?.pendingEffect;
    if (effect?.kind !== "CREATE_PR") return { taskId, kind: "skipped" };
    let prs;
    try {
      prs = JSON.parse(String(this.run("gh", ["pr", "list", "--head", effect.branch, "--state", "all", "--json", "url,number,state"]) || "[]"));
    } catch (error) {
      return this.markManual(state, `查询 PR 失败：${error.message}`);
    }
    if (!Array.isArray(prs) || prs.length !== 1) {
      return this.markManual(state, prs?.length === 0 ? "未找到对应 PR，禁止自动重试" : "找到多个对应 PR，需人工处理");
    }
    const pr = prs[0];
    if (typeof pr.url !== "string" || !pr.url) return this.markManual(state, "PR 查询结果缺少 URL");
    const recovered = await this.taskStore.transitionState(taskId, state.documentRevision, "PR_CREATED", (draft) => {
      draft.submission = { ...(draft.submission || {}), status: "PR_CREATED", branch: effect.branch, prUrl: pr.url, prNumber: pr.number, recoveredAt: new Date().toISOString() };
      draft.control.pendingEffect = null;
      return draft;
    });
    return { taskId, kind: "recovered", state: recovered };
  }
  async markManual(state, reason) {
    const next = await this.taskStore.updateState(state.taskId, state.documentRevision, (draft) => {
      draft.control.pendingEffect = { ...draft.control.pendingEffect, stage: "MANUAL_RECONCILIATION_REQUIRED", manualRequired: true, reason };
      return draft;
    });
    return { taskId: state.taskId, kind: "manual", state: next, reason };
  }
}
module.exports = { ContentPrRecovery };
