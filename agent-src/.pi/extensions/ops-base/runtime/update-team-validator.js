"use strict";

/** updateTeam 专用 before/after validator；不执行 Git、PR 或 workspace 副作用。 */
const crypto = require("node:crypto");
const { PHASE_ORDER } = require("../../../../constants.js");
const { UpdateTeamMvpError } = require("./update-team-mvp.js");
const { generateUpdateTeamOpLog } = require("../../../../scripts/update-team-op-log.js");

const ALLOWED_FIELDS = new Set(["phase", "bossHP", "isLive"]);

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function error(errors, code, path, message) {
  errors.push({ code, path, message });
}

function validateUpdateTeam({ baseline, candidate, plan }) {
  const errors = [];
  const actualChanges = [];
  if (!plan || plan.action !== "updateTeam" || plan.target?.type !== "team" || typeof plan.target.id !== "string") {
    error(errors, "INVALID_PLAN", "$", "confirmed plan 不是有效的 updateTeam 操作单");
    return { success: false, actualChanges, errors };
  }
  if (!Array.isArray(baseline?.teams) || !Array.isArray(candidate?.teams)) {
    error(errors, "INVALID_DATA", "teams", "baseline 和 candidate 都必须包含 teams 数组");
    return { success: false, actualChanges, errors };
  }

  // 根级及非 teams 数据必须完全一致。
  const keys = new Set([...Object.keys(baseline), ...Object.keys(candidate)]);
  for (const key of keys) {
    if (key !== "teams" && !same(baseline[key], candidate[key])) error(errors, "OUT_OF_SCOPE_CHANGE", key, "只允许修改目标 team 字段");
  }
  const baselineIds = baseline.teams.map((team) => team?.id);
  const candidateIds = candidate.teams.map((team) => team?.id);
  if (!same(baselineIds, candidateIds)) error(errors, "TEAM_ORDER_CHANGED", "teams", "不得新增、删除、重排或替换 teams 数组");
  const baselineById = new Map(baseline.teams.map((team) => [team?.id, team]));
  const candidateById = new Map(candidate.teams.map((team) => [team?.id, team]));
  if (baselineById.size !== baseline.teams.length || candidateById.size !== candidate.teams.length) {
    error(errors, "TEAM_ID_INVALID", "teams", "teams 必须拥有唯一 id");
  }
  for (const id of new Set([...baselineById.keys(), ...candidateById.keys()])) {
    const before = baselineById.get(id);
    const after = candidateById.get(id);
    if (!before || !after) {
      error(errors, "OUT_OF_SCOPE_CHANGE", `teams[id=${id}]`, "不得新增、删除或替换 team");
      continue;
    }
    const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const field of fields) {
      if (same(before[field], after[field])) continue;
      const changePath = `teams[id=${id}].${field}`;
      if (id !== plan.target.id) {
        error(errors, "OUT_OF_SCOPE_CHANGE", changePath, "只有 plan target team 可以修改");
        continue;
      }
      if (!ALLOWED_FIELDS.has(field)) {
        error(errors, "UNSUPPORTED_FIELD_CHANGE", changePath, "只允许 phase、bossHP、isLive");
        continue;
      }
      actualChanges.push({ path: changePath, from: before[field], to: after[field], source: "ACTUAL" });
      if (field === "bossHP") {
        if (typeof after[field] !== "number" || !Number.isFinite(after[field]) || after[field] < 0 || after[field] > 100) error(errors, "INVALID_BOSS_HP", changePath, "bossHP 必须在 0~100");
        if (after[field] > before[field]) error(errors, "BOSS_HP_REGRESSION", changePath, "bossHP 不得增加");
      }
      if (field === "isLive" && typeof after[field] !== "boolean") error(errors, "INVALID_IS_LIVE", changePath, "isLive 必须是布尔值");
      if (field === "phase") {
        if (!PHASE_ORDER.includes(before[field]) || !PHASE_ORDER.includes(after[field])) error(errors, "INVALID_PHASE", changePath, "phase 不在 PHASE_ORDER 中");
        else if (PHASE_ORDER.indexOf(after[field]) < PHASE_ORDER.indexOf(before[field])) error(errors, "PHASE_REGRESSION", changePath, "phase 不得后退");
      }
    }
  }

  const expected = Array.isArray(plan.plannedChanges) ? plan.plannedChanges : [];
  const normalize = (changes) => changes.map(({ path, from, to }) => ({ path, from, to })).sort((a, b) => a.path.localeCompare(b.path));
  if (!same(normalize(actualChanges), normalize(expected))) error(errors, "PLAN_DIFF_MISMATCH", "plannedChanges", "actual diff 必须与 confirmed plan 精确一致");
  return { success: errors.length === 0, actualChanges, errors };
}

class UpdateTeamValidator {
  constructor({ taskStore }) { this.taskStore = taskStore; }

  async generateOpLog(taskId, timestamp) {
    const state = await this.taskStore.readTask(taskId);
    if (state.lifecycle.state !== "VALIDATED") throw new UpdateTeamMvpError("OP_LOG_NOT_ALLOWED", "仅 VALIDATED task 可以生成提交 OP_LOG");
    const report = await this.taskStore.readResourceJson(taskId, state.validation.reportResourceId);
    return generateUpdateTeamOpLog(state, report.payload, timestamp);
  }

  async validate(taskId) {
    let state = await this.taskStore.readTask(taskId);
    if (state.lifecycle.state !== "EXECUTING" || state.operation?.action !== "updateTeam" || state.confirmations?.execution?.status !== "CONFIRMED") {
      throw new UpdateTeamMvpError("VALIDATION_NOT_ALLOWED", "仅已确认且 EXECUTING 的 updateTeam 可以校验");
    }
    state = await this.taskStore.transitionState(taskId, state.documentRevision, "VALIDATING");
    const baseline = await this.taskStore.readBaseline(taskId);
    const candidate = await this.taskStore.readCandidateData(taskId);
    const report = {
      success: false,
      actualChanges: [],
      errors: [],
      baselineResourceId: baseline.resource.resourceId,
      candidateResourceId: candidate.resource.resourceId,
      planHash: state.operation.planHash,
    };
    Object.assign(report, validateUpdateTeam({ baseline: baseline.baseline, candidate: candidate.candidate, plan: state.operation }));
    const savedReport = await this.taskStore.saveValidationReport(taskId, state.documentRevision, report);
    if (!report.success) {
      // validator 只产生证据和状态；workspace 恢复由后续受控恢复流程负责，不能在此隐式写入。
      const failed = await this.taskStore.transitionState(taskId, savedReport.state.documentRevision, "VALIDATION_FAILED", (draft) => {
        draft.validation.status = "FAILED";
        return draft;
      });
      return { state: failed, report };
    }
    const savedRecord = await this.taskStore.saveChangeRecord(taskId, savedReport.state.documentRevision, { actualChanges: report.actualChanges, planHash: state.operation.planHash });
    const validated = await this.taskStore.transitionState(taskId, savedRecord.state.documentRevision, "VALIDATED", (draft) => {
      draft.validation.status = "PASSED";
      draft.validation.validatedCandidateSha256 = hash(candidate.candidate);
      return draft;
    });
    return { state: validated, report };
  }
}

module.exports = { UpdateTeamValidator, validateUpdateTeam };
