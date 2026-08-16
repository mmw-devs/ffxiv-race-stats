"use strict";

/** ops-base D3：固定 updateTeam MVP operation，不依赖旧业务 Skill。 */

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PHASE_ORDER } = require("../../../../constants.js");

const ALLOWED_FIELDS = new Set(["phase", "bossHP", "isLive"]);

function configuredOperators() {
  return new Set((process.env.OPS_BASE_ALLOWED_OPEN_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
}

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
  if (trusted.messageId !== state.routing?.currentTurnMessageId) {
    throw new UpdateTeamMvpError("STALE_INGRESS", "当前消息不是 task-store 中已激活的可信 ingress");
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
  constructor({ taskStore, workspaceRoot, allowedOperators = configuredOperators() }) {
    this.taskStore = taskStore;
    this.workspaceRoot = workspaceRoot;
    this.allowedOperators = new Set(allowedOperators);
  }

  assertAuthorized(state) {
    if (!this.allowedOperators.has(state.operator?.feishuOpenId)) {
      throw new UpdateTeamMvpError("AUTHORIZATION_DENIED", "operator 不在 OPS_BASE_ALLOWED_OPEN_IDS 的 updateTeam 授权列表中");
    }
  }

  async advanceToPlanning(state, trusted) {
    const paths = {
      CREATED: ["AUTHORIZING", "PREPARING", "IDENTIFYING", "PLANNING"],
      AUTHORIZING: ["PREPARING", "IDENTIFYING", "PLANNING"],
      PREPARING: ["IDENTIFYING", "PLANNING"],
      IDENTIFYING: ["PLANNING"],
      AWAITING_INFORMATION: ["IDENTIFYING", "PLANNING"],
      AWAITING_CONFIRMATION: ["IDENTIFYING", "PLANNING"],
      PLANNING: [],
    };
    const steps = paths[state.lifecycle.state];
    if (!steps) throw new UpdateTeamMvpError("INVALID_LIFECYCLE", `当前状态 ${state.lifecycle.state} 不允许规划或重规划`);
    for (const nextState of steps) {
      state = await this.taskStore.transitionState(state.taskId, state.documentRevision, nextState, (draft) => {
        assertTrustedTask(draft, trusted);
        return draft;
      });
    }
    return state;
  }

  async plan(trusted, request) {
    let state = await this.taskStore.readTask(trusted.taskId);
    assertTrustedTask(state, trusted);
    this.assertAuthorized(state);
    state = await this.advanceToPlanning(state, trusted);

    // 首次有效计划固化 snapshot；后续重计划永远从同一 baseline 推导，不能偷读已变化的 data.json。
    let baseline;
    let baselineResource;
    if (state.execution?.baselineResourceId) {
      const saved = await this.taskStore.readBaseline(state.taskId);
      state = saved.state;
      baseline = saved.baseline;
      baselineResource = saved.resource;
    } else {
      const current = await readRaceData(this.workspaceRoot);
      const team = resolveTeam(current.data.teams, request);
      const fields = requestedValues(request);
      const plannedChanges = buildChanges(team, request, fields);
      if (plannedChanges.length === 0) throw new UpdateTeamMvpError("NO_EFFECT", "请求不会产生任何数据变化");
      const saved = await this.taskStore.saveBaseline(state.taskId, state.documentRevision, current.data, current.sha256);
      state = saved.state;
      baseline = current.data;
      baselineResource = saved.resource;
    }

    const team = resolveTeam(baseline.teams, request);
    const fields = requestedValues(request);
    const plannedChanges = buildChanges(team, request, fields);
    if (plannedChanges.length === 0) throw new UpdateTeamMvpError("NO_EFFECT", "请求不会产生任何数据变化");
    const plan = {
      business: "raceProgress",
      action: "updateTeam",
      target: { type: "team", id: team.id, displayName: team.name },
      requestedFields: fields.map((field) => ({
        path: `teams[id=${team.id}].${field}`,
        value: request[field],
        sourceMessageId: trusted.messageId,
      })),
      plannedChanges: plannedChanges.map((change) => ({
        path: change.field,
        from: change.from,
        to: change.to,
        source: "OPERATOR",
      })),
      missingInformation: [],
      plannedAt: new Date().toISOString(),
      baselineDataSha256: baselineResource.locator.sourceSha256,
      baselineResourceId: baselineResource.resourceId,
    };
    plan.planHash = `sha256:${sha256(stableJson({ taskId: state.taskId, operator: state.operator.feishuOpenId, ...plan }))}`;

    const next = await this.taskStore.transitionState(state.taskId, state.documentRevision, "AWAITING_CONFIRMATION", (draft) => {
      assertTrustedTask(draft, trusted);
      draft.operation = { ...plan, planRevision: (draft.operation?.planRevision || 0) + 1, status: "AWAITING_CONFIRMATION" };
      return draft;
    });
    return { kind: "plan", state: next, plan: next.operation };
  }

  async confirm(trusted, confirmation) {
    const state = await this.taskStore.readTask(trusted.taskId);
    assertTrustedTask(state, trusted);
    this.assertAuthorized(state);
    const plan = state.operation;
    if (state.lifecycle.state !== "AWAITING_CONFIRMATION" || !plan || plan.action !== "updateTeam") {
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

    const savedBaseline = await this.taskStore.readBaseline(state.taskId);
    if (plan.baselineResourceId !== savedBaseline.resource.resourceId
      || plan.baselineDataSha256 !== savedBaseline.resource.locator.sourceSha256) {
      throw new UpdateTeamMvpError("BASELINE_MISMATCH", "计划引用的 baseline snapshot 不一致");
    }
    // 必须在写入 CONFIRMED 前检查当前数据，失败时保留 AWAITING_CONFIRMATION，确认不产生副作用。
    const { sha256: currentSha256 } = await readRaceData(this.workspaceRoot);
    if (currentSha256 !== plan.baselineDataSha256) {
      throw new UpdateTeamMvpError("BASELINE_CHANGED", "data.json 已变化，旧 plan 不能产生 candidate");
    }

    const confirmed = await this.taskStore.transitionState(state.taskId, state.documentRevision, "CONFIRMED", (draft) => {
      assertTrustedTask(draft, trusted);
      if (draft.lifecycle.state !== "AWAITING_CONFIRMATION" || draft.operation?.planHash !== confirmation.planHash) {
        throw new UpdateTeamMvpError("STALE_PLAN_CONFIRMATION", "确认期间计划已变化");
      }
      draft.confirmations = draft.confirmations || {};
      draft.confirmations.execution = {
        confirmedByFeishuOpenId: confirmation.feishuOpenId,
        status: "CONFIRMED",
        confirmationMessageId: confirmation.messageId,
        confirmedAt: new Date().toISOString(),
        boundAttempt: draft.lifecycle.attempt,
        boundBaselineResourceId: plan.baselineResourceId,
        boundPlanHash: confirmation.planHash,
      };
      return draft;
    });

    const candidate = structuredClone(savedBaseline.baseline);
    const team = candidate.teams.find((item) => item.id === plan.target.id);
    if (!team) throw new UpdateTeamMvpError("TEAM_NOT_FOUND", "candidate 中找不到目标 team");
    for (const change of plan.plannedChanges) {
      const field = change.path.slice(change.path.lastIndexOf(".") + 1);
      team[field] = change.to;
    }
    const saved = await this.taskStore.saveCandidateData(confirmed.taskId, confirmed.documentRevision, candidate);
    const executing = await this.taskStore.transitionState(saved.state.taskId, saved.state.documentRevision, "EXECUTING", (draft) => {
      draft.execution.candidateSha256 = `sha256:${sha256(JSON.stringify(candidate))}`;
      return draft;
    });
    return { kind: "candidate", state: executing, candidateResourceId: executing.execution.candidateResourceId, plan };
  }
}

module.exports = { PHASE_ORDER, UpdateTeamMvp, UpdateTeamMvpError, buildChanges, resolveTeam };
