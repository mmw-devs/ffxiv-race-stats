"use strict";

const { PHASE_ORDER } = require("../constants.js");
const ALLOWED_FIELDS = new Set(["phase", "bossHP", "isLive"]);

function normalize(changes) {
  return changes.map(({ field, path, from, to }) => ({ field: field || path, from, to }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

/** 只从 task state + validator report 生成提交日志；不接收 Agent 提供的 changes。 */
function generateUpdateTeamOpLog(state, validationReport, timestamp = new Date().toISOString()) {
  if (state?.operation?.action !== "updateTeam" || state?.confirmations?.execution?.status !== "CONFIRMED") throw new Error("task 未处于已确认 updateTeam 状态");
  if (!validationReport?.success || !Array.isArray(validationReport.actualChanges)) throw new Error("只能使用成功 validator 的 actualChanges 生成 OP_LOG");
  return {
    operator: state.operator.feishuOpenId,
    timestamp,
    action: "updateTeam",
    target: state.operation.target.id,
    changes: validationReport.actualChanges.map(({ path, from, to }) => ({ field: path, from, to })),
  };
}

function actualChanges(baseline, candidate, target) {
  const changes = [];
  const errors = [];
  const beforeIds = (baseline.teams || []).map((team) => team.id);
  const afterIds = (candidate.teams || []).map((team) => team.id);
  if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) errors.push("teams 数组顺序或 id 序列发生变化");
  const beforeTeams = new Map((baseline.teams || []).map((team) => [team.id, team]));
  const afterTeams = new Map((candidate.teams || []).map((team) => [team.id, team]));
  if (beforeTeams.size !== (baseline.teams || []).length || afterTeams.size !== (candidate.teams || []).length) return { changes, errors: ["teams id 不唯一"] };
  if (JSON.stringify(Object.fromEntries(Object.entries(baseline).filter(([key]) => key !== "teams"))) !== JSON.stringify(Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "teams")))) errors.push("存在 teams 外变更");
  for (const id of new Set([...beforeTeams.keys(), ...afterTeams.keys()])) {
    const before = beforeTeams.get(id), after = afterTeams.get(id);
    if (!before || !after) { errors.push(`team ${id} 被新增、删除或替换`); continue; }
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
      const path = `teams[id=${id}].${field}`;
      if (id !== target) errors.push(`${path} 不是目标 team`);
      else if (!ALLOWED_FIELDS.has(field)) errors.push(`${path} 不是允许字段`);
      else {
        changes.push({ field: path, from: before[field], to: after[field] });
        if (field === "bossHP" && (typeof after[field] !== "number" || after[field] < 0 || after[field] > 100 || after[field] > before[field])) errors.push(`${path} bossHP 非法或增加`);
        if (field === "phase" && (!PHASE_ORDER.includes(before[field]) || !PHASE_ORDER.includes(after[field]) || PHASE_ORDER.indexOf(after[field]) < PHASE_ORDER.indexOf(before[field]))) errors.push(`${path} phase 非法或后退`);
      }
    }
  }
  return { changes, errors };
}

/** CI 独立计算实际 diff，绝不信任本地 validator result 或 Agent 文本。 */
function validateUpdateTeamOpLog({ log, baseline, candidate, allowlist }) {
  const errors = [];
  if (!Array.isArray(allowlist) || !allowlist.includes(log?.operator)) errors.push("operator 不在完整 open_id allowlist");
  if (log?.action !== "updateTeam") errors.push("action 必须是 updateTeam");
  if (typeof log?.target !== "string" || !log.target) errors.push("target 必须是 team id");
  const actual = actualChanges(baseline, candidate, log?.target);
  errors.push(...actual.errors);
  if (JSON.stringify(normalize(log?.changes || [])) !== JSON.stringify(normalize(actual.changes))) errors.push("OP_LOG changes 与真实 diff 不一致");
  return { success: errors.length === 0, actualChanges: actual.changes, errors };
}

module.exports = { generateUpdateTeamOpLog, validateUpdateTeamOpLog };
