"use strict";

/** ops-base D3：固定 updateTeam MVP operation，不依赖旧业务 Skill。 */

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { TaskStoreInvariantError } = require("./task-store.js");

const PHASE_ORDER = ["P1", "P2", "P3", "P4", "CLEAR"];
const ALLOWED_FIELDS = new Set(["phase", "bossHP", "isLive"]);

class UpdateTeamMvpError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readRaceData(workspaceRoot) {
  const file = path.join(workspaceRoot, "public", "data.json");
  const source = await fs.readFile(file, "utf8");
  return { data: JSON.parse(source), sha256: `sha256:${sha256(source)}` };
}

function assertTrustedTask(state, trusted) {
  if (!trusted || trusted.taskId !== state.taskId || trusted.feishuOpenId !== state.operator?.feishuOpenId) {
    throw new UpdateTeamMvpError("UNTRUSTED_CONTEXT", "taskId 或 operator 不来自可信 task context");
  }
  if (trusted.messageId !== state.routing?.lastInboundMessageId) {
    throw new UpdateTeamMvpError("STALE_INGRESS", "当前消息不是 task-store 中的最新可信 ingress");
  }
}

function resolveTeam(teams, request) {
  if (typeof request.teamId === "string" && request.teamId) {
    const matches = teams.filter((team) => team.id === request.teamId);
    if (matches.length === 1) return matches[0];
    throw new UpdateTeamMvpError("TEAM_NOT_FOUND", `未找到 team id：${request.teamId}`);
  }
  if (typeof request.teamName === "string" && request.teamName) {
    const matches = teams.filter((team) => team.name === request.teamName);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new UpdateTeamMvpError("TEAM_AMBIGUOUS", "队伍名称不唯一，请提供 team id", { teamName: request.teamName });
    throw new UpdateTeamMvpError("TEAM_NOT_FOUND", `未找到队伍：${request.teamName}`);
  }
  throw new UpdateTeamMvpError("MISSING_INFORMATION", "缺少 team id", { missing: ["teamId"] });
}

function requestedValues(request) {
  const forbidden = Object.keys(request).filter((field) => !["teamId", "teamName", ...ALLOWED_FIELDS].includes(field));
  if (forbidden.length > 0) {
    throw new UpdateTeamMvpError("UNSUPPORTED_FIELD", "只允许修改 phase、bossHP、isLive", { forbidden });
  }
  const fields = [...ALLOWED_FIELDS].filter((field) => Object.hasOwn(request, field));
  if (fields.length === 0) throw new UpdateTeamMvpError("MISSING_INFORMATION", "缺少要更新的字段", { missing: ["phase", "bossHP", "isLive"] });
  return fields;
}

function buildChanges(team, request, fields) {
  const changes = [];
  for (const field of fields) {
    const next = request[field];
    if (field === "phase") {
      if (typeof next !== "string" || !PHASE_ORDER.includes(next)) {
        throw new UpdateTeamMvpError("INVALID_PHASE", "phase 仅允许 P1/P2/P3/P4/CLEAR");
      }
      if (PHASE_ORDER.indexOf(next) < PHASE_ORDER.indexOf(team.phase)) {
        throw new UpdateTeamMvpError("PHASE_REGRESSION", "phase 不得后退");
      }
    }
    if (field === "bossHP") {
      if (typeof next !== "number" || !Number.isFinite(next) || next < 0 || next > 100) {
        throw new UpdateTeamMvpError("INVALID_BOSS_HP", "bossHP 必须是 0 到 100 的数值");
      }
      if (next > team.bossHP) throw new UpdateTeamMvpError("BOSS_HP_REGRESSION", "bossHP 不得增加");
    }
    if (field === "isLive" && typeof next !== "boolean") {
      throw new UpdateTeamMvpError("INVALID_IS_LIVE", "isLive 必须是布尔值，且只能由用户明确提供");
    }
    if (team[field] !== next) changes.push({ field: `teams[id=${team.id}].${field}`, from: team[field], to: next });
  }
  return changes;
}

class UpdateTeamMvp {
  constructor({ taskStore, workspaceRoot }) {
    this.taskStore = taskStore;
    this.workspaceRoot = workspaceRoot;
  }

  async plan(trusted, request) {
    const state = await this.taskStore.readTask(trusted.taskId);
    assertTrustedTask(state, trusted);
    const { data, sha256: baselineSha256 } = await readRaceData(this.workspaceRoot);
    const team = resolveTeam(data.teams, request);
    const fields = requestedValues(request);
    const plannedChanges = buildChanges(team, request, fields);
    if (plannedChanges.length === 0) {
      throw new UpdateTeamMvpError("NO_EFFECT", "请求不会产生任何数据变化");
    }
    const plan = {
      operationId: "updateTeam",
      target: { teamId: team.id },
      requestedFields: fields,
      plannedChanges,
      baselineDataSha256: baselineSha256,
    };
    plan.planHash = `sha256:${sha256(stableJson({ taskId: state.taskId, operator: state.operator.feishuOpenId, ...plan }))}`;

    const next = await this.taskStore.updateState(state.taskId, state.documentRevision, (draft) => {
      assertTrustedTask(draft, trusted);
      draft.operation = { ...plan, planRevision: (draft.operation?.planRevision || 0) + 1, status: "AWAITING_CONFIRMATION" };
      draft.lifecycle.state = "AWAITING_CONFIRMATION";
      return draft;
    });
    return { kind: "plan", state: next, plan: next.operation };
  }

  async confirm(trusted, confirmation) {
    const state = await this.taskStore.readTask(trusted.taskId);
    assertTrustedTask(state, trusted);
    const plan = state.operation;
    if (state.lifecycle.state !== "AWAITING_CONFIRMATION" || !plan || plan.operationId !== "updateTeam") {
      throw new UpdateTeamMvpError("PLAN_NOT_AWAITING_CONFIRMATION", "当前 task 没有等待确认的 updateTeam 操作单");
    }
    if (confirmation?.feishuOpenId !== state.operator.feishuOpenId) {
      throw new UpdateTeamMvpError("CONFIRMATION_OPERATOR_MISMATCH", "只有原 operator 可以确认操作单");
    }
    if (confirmation?.planHash !== plan.planHash) {
      throw new UpdateTeamMvpError("STALE_PLAN_CONFIRMATION", "确认的 planHash 已过期或不匹配");
    }
    if (confirmation?.messageId !== trusted.messageId) {
      throw new UpdateTeamMvpError("CONFIRMATION_MESSAGE_MISMATCH", "确认消息不是当前可信 ingress");
    }

    const confirmed = await this.taskStore.updateState(state.taskId, state.documentRevision, (draft) => {
      draft.confirmations = draft.confirmations || {};
      draft.confirmations.execution = {
        confirmedByFeishuOpenId: confirmation.feishuOpenId,
        messageId: confirmation.messageId,
        planHash: confirmation.planHash,
        confirmedAt: new Date().toISOString(),
      };
      draft.lifecycle.state = "CONFIRMED";
      return draft;
    });

    const { data, sha256: currentSha256 } = await readRaceData(this.workspaceRoot);
    if (currentSha256 !== plan.baselineDataSha256) {
      throw new UpdateTeamMvpError("BASELINE_CHANGED", "data.json 已变化，旧 plan 不能产生 candidate");
    }
    const candidate = structuredClone(data);
    const team = candidate.teams.find((item) => item.id === plan.target.teamId);
    if (!team) throw new UpdateTeamMvpError("TEAM_NOT_FOUND", "candidate 中找不到目标 team");
    for (const change of plan.plannedChanges) {
      const field = change.field.slice(change.field.lastIndexOf(".") + 1);
      team[field] = change.to;
    }
    const saved = await this.taskStore.saveCandidateData(confirmed.taskId, confirmed.documentRevision, candidate);
    const executing = await this.taskStore.updateState(saved.state.taskId, saved.state.documentRevision, (draft) => {
      draft.lifecycle.state = "EXECUTING";
      draft.execution.candidateSha256 = `sha256:${sha256(JSON.stringify(candidate))}`;
      return draft;
    });
    return { kind: "candidate", state: executing, candidateResourceId: executing.execution.candidateResourceId, plan };
  }
}

module.exports = { PHASE_ORDER, UpdateTeamMvp, UpdateTeamMvpError, buildChanges, resolveTeam };
