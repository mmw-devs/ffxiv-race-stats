"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/**
 * 任务结束不是一组可交换的清理动作，而是受 lifecycle guard 约束的有序流程。
 * 外部副作用的结果不会由本类在启动时猜测或重放；每次 state 写入只是为
 * 调用方/人工对账留下最后一个已知检查点。
 */
class TaskEndService {
  constructor({ taskStore, workspaceRoot, run = (file, args) => execFileSync(file, args, { cwd: workspaceRoot, encoding: "utf8" }) }) {
    this.taskStore = taskStore;
    this.workspaceRoot = workspaceRoot;
    this.run = run;
  }

  /**
   * 启动恢复只处理尚未结束 task 的 pendingEffect：CREATE_PR 留给
   * ContentPrRecovery 做只读 PR 对账，其余未知副作用尝试标为 ERROR，
   * 供人工处理。本方法不会关闭 PR、checkout 分支或重写 data.json。
   */
  async recoverAll() {
    const tasks = await this.taskStore.scanNonEndedTasks();
    const results = [];
    for (const state of tasks) {
      const effect = state.control?.pendingEffect;
      if (!effect || effect.kind === "CREATE_PR") {
        results.push({ taskId: state.taskId, kind: "restored" });
        continue;
      }
      try {
        const next = await this.taskStore.transitionState(state.taskId, state.documentRevision, "ERROR", (draft) => {
          draft.control.pendingEffect = {
            ...effect,
            stage: "MANUAL_RECONCILIATION_REQUIRED",
            reason: "启动恢复遇到未知副作用",
          };
          return draft;
        });
        results.push({ taskId: state.taskId, kind: "error", state: next });
      } catch (error) {
        results.push({ taskId: state.taskId, kind: "manual", error: error.message });
      }
    }
    return results;
  }

  /**
   * 结束协议的顺序不可调整：
   * 1. 先检查 PR 是否已合并；已合并时只能走 MERGED → CLEANING，绝不能
   *    关闭 PR 或用 baseline 覆盖已合并的数据。
   * 2. 未合并时先持久化 CANCELLING，再关闭已有 PR；关闭成功后才登记
   *    CLOSED_BY_END，避免 state 声称已关闭而远端命令尚未执行。
   * 3. 只有 workspace candidate 已登记时，才进入 RESTORING、读取 baseline、
   *    checkout main 并写回 data.json；写回成功后才清除 candidate 标记。
   * 4. 最后由 clean 依次持久化 CLEANING、cleanup 结果和 ENDED。
   *
   * 任一外部命令或 state 写入抛错都会保留此前的持久检查点。例如 PR 关闭
   * 后但状态更新前中断时，CANCELLING 仍可能对应一个已经关闭的远端 PR；
   * baseline 写回后但状态更新前中断时，RESTORING 仍保留 candidate 标记。
   * 启动恢复不会猜测这些结果或盲目重放命令，必须依据该检查点受控继续或
   * 人工对账。只有已经到达 ENDED 的再次调用明确是幂等的。
   */
  async end(taskId) {
    let state = await this.taskStore.readTask(taskId);
    if (state.lifecycle.state === "ENDED") return { state, idempotent: true };

    const merged = await this.isMerged(state);
    if (merged) {
      state = await this.to(state, "MERGED");
      return this.clean(state, "merged");
    }

    state = await this.to(state, "CANCELLING");
    const hasWorkspaceChange = Boolean(state.execution?.workspaceCandidateSha256);
    if (state.submission?.prUrl) {
      this.run("gh", ["pr", "close", state.submission.prUrl]);
      state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => {
        draft.submission = { ...draft.submission, status: "CLOSED_BY_END" };
        return draft;
      });
    }
    if (hasWorkspaceChange) {
      state = await this.to(state, "RESTORING");
      const baseline = await this.taskStore.readBaseline(taskId);
      this.run("git", ["checkout", "main"]);
      await fs.writeFile(
        path.join(this.workspaceRoot, "public", "data.json"),
        `${JSON.stringify(baseline.baseline, null, 2)}\n`,
      );
      state = await this.taskStore.updateState(taskId, state.documentRevision, (draft) => {
        draft.execution.workspaceCandidateSha256 = null;
        draft.control.pendingEffect = null;
        return draft;
      });
    }
    return this.clean(state, hasWorkspaceChange ? "restored" : "no_workspace_change");
  }

  /**
   * 远端查询失败沿用既有行为：按“未确认已合并”处理并返回 false；这里不
   * 吞掉已持久化状态，也不把查询失败伪装成 MERGED。
   */
  async isMerged(state) {
    if (state.lifecycle.state === "MERGED") return true;
    if (!state.submission?.prUrl) return false;
    try {
      const result = JSON.parse(String(this.run("gh", ["pr", "view", state.submission.prUrl, "--json", "mergedAt"]) || "{}"));
      return Boolean(result.mergedAt);
    } catch {
      return false;
    }
  }

  /**
   * 不能直接跳到目标状态：TaskStore 会拒绝跨越 ALLOWED_TRANSITIONS 的写入。
   * 此处按既有中间状态逐步推进，并跳过已到达的节点，使同一进程内的后续
   * 调用保留状态机审计轨迹，而不改变各边的合法性判断。
   */
  async to(state, target) {
    if (state.lifecycle.state === target) return state;
    const paths = {
      MERGED: ["AWAITING_MERGE", "MERGING", "MERGED"],
      CANCELLING: ["CANCELLING"],
      RESTORING: ["RESTORING"],
    };
    for (const next of paths[target] || []) {
      if (state.lifecycle.state === next) continue;
      state = await this.taskStore.transitionState(state.taskId, state.documentRevision, next);
    }
    return state;
  }

  /**
   * 清理也分三个持久检查点：先进入 CLEANING，再记录 cleanup 已完成，最后
   * 进入 ENDED。不要提前写 ENDED；否则失败时会丢失 cleanup 尚未完成的事实。
   * 反过来，CLEANING 或已写 cleanup 但未 ENDED 都不是已完成的幂等终态。
   */
  async clean(state, reason) {
    if (state.lifecycle.state !== "CLEANING") {
      state = await this.taskStore.transitionState(state.taskId, state.documentRevision, "CLEANING");
    }
    state = await this.taskStore.updateState(state.taskId, state.documentRevision, (draft) => {
      draft.cleanup = {
        ...(draft.cleanup || {}),
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        reason,
      };
      return draft;
    });
    return {
      state: await this.taskStore.transitionState(state.taskId, state.documentRevision, "ENDED"),
      idempotent: false,
    };
  }
}
module.exports = { TaskEndService };
