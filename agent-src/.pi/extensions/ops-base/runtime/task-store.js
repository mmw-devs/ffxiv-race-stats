"use strict";

/**
 * ops-base 第一阶段任务状态存储。
 *
 * state.json 是唯一当前状态源。所有 state 修改都经过 task 目录互斥锁、
 * documentRevision CAS 和原子 replace；artifact 只保存大对象，引用登记在 state 中。
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const TASK_ID_PATTERN = /^opst_[0-9A-HJKMNP-TV-Z]{26}$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const STATE_FILE = "state.json";
const LOCK_DIRECTORY = "mutation.lock";
const OWNER_FILE = "owner.json";

// 生命周期只能沿显式边转移；所有 state 写入即使经通用 CAS 也不能跨越此守卫。
const ALLOWED_TRANSITIONS = {
  CREATED: new Set(["AUTHORIZING", "CANCELLING"]),
  AUTHORIZING: new Set(["PREPARING", "CLEANING", "CANCELLING"]),
  PREPARING: new Set(["IDENTIFYING", "CANCELLING"]),
  IDENTIFYING: new Set(["AWAITING_INFORMATION", "PLANNING", "CLEANING", "CANCELLING"]),
  AWAITING_INFORMATION: new Set(["IDENTIFYING", "CANCELLING"]),
  PLANNING: new Set(["AWAITING_CONFIRMATION", "CANCELLING"]),
  AWAITING_CONFIRMATION: new Set(["IDENTIFYING", "CONFIRMED", "CANCELLING"]),
  CONFIRMED: new Set(["EXECUTING", "CANCELLING"]),
  EXECUTING: new Set(["VALIDATING", "CANCELLING"]),
  VALIDATING: new Set(["VALIDATED", "VALIDATION_FAILED", "CANCELLING"]),
  VALIDATED: new Set(["SUBMITTING", "CANCELLING"]),
  SUBMITTING: new Set(["PR_CREATED", "ERROR", "CANCELLING"]),
  PR_CREATED: new Set(["AWAITING_MERGE", "CANCELLING"]),
  AWAITING_MERGE: new Set(["MERGING", "VALIDATION_FAILED", "CANCELLING"]),
  MERGING: new Set(["MERGED", "ERROR", "CANCELLING"]),
  MERGED: new Set(["CLEANING"]),
  VALIDATION_FAILED: new Set(["RESTORING"]),
  CANCELLING: new Set(["MERGED", "RESTORING", "CLEANING", "ERROR"]),
  RESTORING: new Set(["CLEANING", "ERROR"]),
  CLEANING: new Set(["ENDED", "ERROR"]),
  ERROR: new Set([]),
  ENDED: new Set([]),
};

class TaskStoreError extends Error {}
class CompareAndSwapError extends TaskStoreError {}
class MutationLockBusyError extends TaskStoreError {}
class RuntimeRootError extends TaskStoreError {}
class TaskStoreInvariantError extends TaskStoreError {}

function utcNow() {
  return new Date().toISOString();
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function encodeTime(timestamp) {
  let value = BigInt(timestamp);
  let result = "";
  for (let index = 0; index < 10; index += 1) {
    result = CROCKFORD[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}

function encodeRandom(bytes) {
  // 80 bit random value -> 16 个 Crockford Base32 字符。
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let result = "";
  for (let index = 0; index < 16; index += 1) {
    result = CROCKFORD[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}

function generateTaskId(now = Date.now()) {
  return `opst_${encodeTime(now)}${encodeRandom(crypto.randomBytes(10))}`;
}

function assertTaskId(taskId) {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new TaskStoreInvariantError(`非法 taskId：${taskId}`);
  }
}

async function fsyncDirectory(directory) {
  // Windows 不保证目录 fsync；无法打开时保留 rename 的原子性而不把平台差异伪装成成功。
  try {
    const handle = await fsp.open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

async function writeJsonAtomically(file, value, options = {}) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const content = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await fsp.open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (options.beforeRename) await options.beforeRename(temporary);
    await fsp.rename(temporary, file);
    await fsyncDirectory(directory);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function mkdirExclusive(directory) {
  try {
    await fsp.mkdir(directory, { mode: 0o700 });
    return true;
  } catch (error) {
    if (error && error.code === "EEXIST") return false;
    throw error;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class TaskStore {
  constructor(options = {}) {
    this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    this.runtimeRoot = path.resolve(
      options.runtimeRoot || process.env.OPS_BASE_RUNTIME_ROOT || path.join(os.homedir(), ".pi", "ops-base-runtime"),
    );
    this.now = options.now || utcNow;
    this.beforeStateRename = options.beforeStateRename;
  }

  async initialize() {
    const workspace = await fsp.realpath(this.workspaceRoot).catch(() => this.workspaceRoot);
    if (isWithin(this.runtimeRoot, workspace)) {
      throw new RuntimeRootError(`OPS_BASE_RUNTIME_ROOT 必须位于 Git workspace 外：${this.runtimeRoot}`);
    }
    await fsp.mkdir(this.runtimeRoot, { recursive: true, mode: 0o700 });
    await fsp.chmod(this.runtimeRoot, 0o700);
    const resolvedRoot = await fsp.realpath(this.runtimeRoot);
    if (isWithin(resolvedRoot, workspace)) {
      throw new RuntimeRootError(`runtime-root 解析后位于 Git workspace 内：${resolvedRoot}`);
    }
    await fsp.mkdir(this.tasksRoot(), { recursive: true, mode: 0o700 });
    return this;
  }

  tasksRoot() {
    return path.join(this.runtimeRoot, "tasks");
  }

  taskDirectory(taskId) {
    assertTaskId(taskId);
    return path.join(this.tasksRoot(), taskId);
  }

  statePath(taskId) {
    return path.join(this.taskDirectory(taskId), STATE_FILE);
  }

  globalLockDirectory() {
    return path.join(this.runtimeRoot, LOCK_DIRECTORY);
  }

  async createTask(input = {}) {
    const taskId = input.taskId || generateTaskId();
    assertTaskId(taskId);
    const acquiredAt = this.now();
    await this.acquireMutationLock(taskId, acquiredAt);
    const directory = this.taskDirectory(taskId);
    try {
      const made = await mkdirExclusive(directory);
      if (!made) throw new TaskStoreInvariantError(`task 已存在：${taskId}`);
      await fsp.mkdir(path.join(directory, "artifacts"), { mode: 0o700 });
      const state = this.createInitialState(taskId, input, acquiredAt);
      await this.writeState(state);
      return clone(state);
    } catch (error) {
      await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
      await this.releaseMutationLock(taskId).catch(() => {});
      throw error;
    }
  }

  createInitialState(taskId, input, timestamp) {
    return {
      schemaVersion: "1.0.0",
      taskId,
      documentRevision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      lifecycle: {
        state: input.lifecycleState || "CREATED",
        stateVersion: 1,
        attempt: 1,
        enteredAt: timestamp,
      },
      routing: input.routing || null,
      operator: input.operator || null,
      operation: input.operation || null,
      execution: { baselineResourceId: null },
      validation: { reportResourceId: null, changeRecordResourceId: null },
      resources: { items: [] },
      control: { pendingEffect: null },
    };
  }

  async readTask(taskId) {
    const state = await readJson(this.statePath(taskId));
    this.assertState(state, taskId);
    return state;
  }

  async updateState(taskId, expectedDocumentRevision, mutate) {
    return this.withTaskLock(taskId, async () => {
      const current = await this.readTask(taskId);
      if (current.documentRevision !== expectedDocumentRevision) {
        throw new CompareAndSwapError(
          `state revision 不匹配：期望 ${expectedDocumentRevision}，实际 ${current.documentRevision}`,
        );
      }
      const proposed = await mutate(clone(current));
      if (!proposed || typeof proposed !== "object") {
        throw new TaskStoreInvariantError("state mutator 必须返回对象");
      }
      proposed.taskId = current.taskId;
      proposed.schemaVersion = current.schemaVersion;
      proposed.createdAt = current.createdAt;
      proposed.documentRevision = current.documentRevision + 1;
      proposed.updatedAt = this.now();
      if (!proposed.lifecycle || typeof proposed.lifecycle.state !== "string") {
        throw new TaskStoreInvariantError("state 缺少 lifecycle.state");
      }
      if (proposed.lifecycle.state !== current.lifecycle.state
        && !ALLOWED_TRANSITIONS[current.lifecycle.state]?.has(proposed.lifecycle.state)) {
        throw new TaskStoreInvariantError(`非法 lifecycle 转移：${current.lifecycle.state} → ${proposed.lifecycle.state}`);
      }
      proposed.lifecycle.stateVersion = proposed.lifecycle.state === current.lifecycle.state
        ? current.lifecycle.stateVersion
        : current.lifecycle.stateVersion + 1;
      if (proposed.lifecycle.state !== current.lifecycle.state) proposed.lifecycle.enteredAt = proposed.updatedAt;
      this.assertState(proposed, taskId);
      await this.writeState(proposed);
      return clone(proposed);
    });
  }

  async transitionState(taskId, expectedDocumentRevision, nextState, mutate = (state) => state) {
    return this.updateState(taskId, expectedDocumentRevision, (state) => {
      const next = mutate(state);
      next.lifecycle.state = nextState;
      return next;
    });
  }

  async saveBaseline(taskId, expectedDocumentRevision, baseline, sourceSha256) {
    if (typeof sourceSha256 !== "string" || !sourceSha256.startsWith("sha256:")) {
      throw new TaskStoreInvariantError("baseline 必须携带来源 data.json 的 sha256");
    }
    return this.saveJsonArtifact(taskId, expectedDocumentRevision, "baseline", baseline, { sourceSha256 });
  }

  async readResourceJson(taskId, resourceId) {
    const state = await this.readTask(taskId);
    const resource = state.resources.items.find((item) => item.resourceId === resourceId);
    if (!resource?.locator?.path) throw new TaskStoreInvariantError(`JSON resource 缺失：${resourceId}`);
    const artifactPath = path.join(this.taskDirectory(taskId), ...resource.locator.path.split("/"));
    return { state, resource: clone(resource), payload: await readJson(artifactPath) };
  }

  async readBaseline(taskId) {
    const result = await this.readResourceJson(taskId, (await this.readTask(taskId)).execution?.baselineResourceId);
    if (typeof result.resource.locator.sourceSha256 !== "string") throw new TaskStoreInvariantError("baseline 来源 sha256 缺失");
    return { state: result.state, resource: result.resource, baseline: result.payload };
  }

  async readCandidateData(taskId) {
    const result = await this.readResourceJson(taskId, (await this.readTask(taskId)).execution?.candidateResourceId);
    return { state: result.state, resource: result.resource, candidate: result.payload };
  }

  async saveValidationReport(taskId, expectedDocumentRevision, report) {
    return this.saveJsonArtifact(taskId, expectedDocumentRevision, "validation-report", report);
  }

  async saveChangeRecord(taskId, expectedDocumentRevision, record) {
    return this.saveJsonArtifact(taskId, expectedDocumentRevision, "change-record", record);
  }

  async saveJsonArtifact(taskId, expectedDocumentRevision, kind, payload, options = {}) {
    const definitions = {
      baseline: { filename: "baseline-data", resourceId: "res_baseline_snapshot", type: "TEMP_FILE", pointer: ["execution", "baselineResourceId"] },
      "validation-report": { filename: "validation-report-attempt", resourceId: "res_validation_report", type: "TEMP_FILE", pointer: ["validation", "reportResourceId"] },
      "change-record": { filename: "change-record-attempt", resourceId: "res_change_record", type: "CHANGE_RECORD", pointer: ["validation", "changeRecordResourceId"] },
      candidate: { filename: "candidate-data", resourceId: "res_candidate_data", type: "TEMP_FILE", pointer: ["execution", "candidateResourceId"] },
      "candidate-restore": { filename: "candidate-restored-baseline", resourceId: "res_candidate_restore", type: "TEMP_FILE", pointer: ["execution", "candidateResourceId"] },
    };
    const definition = definitions[kind];
    if (!definition) throw new TaskStoreInvariantError(`未知 artifact 类型：${kind}`);

    return this.withTaskLock(taskId, async () => {
      const current = await this.readTask(taskId);
      if (current.documentRevision !== expectedDocumentRevision) {
        throw new CompareAndSwapError(
          `artifact revision 不匹配：期望 ${expectedDocumentRevision}，实际 ${current.documentRevision}`,
        );
      }
      const suffix = kind === "baseline" ? "" : `-${current.lifecycle.attempt || 1}`;
      const filename = `${definition.filename}${suffix}.json`;
      const resourceId = `${definition.resourceId}_${current.lifecycle.attempt || 1}`;
      if (current.resources.items.some((item) => item.resourceId === resourceId)) {
        throw new TaskStoreInvariantError(`artifact 已登记：${resourceId}`);
      }
      const artifactPath = path.join(this.taskDirectory(taskId), "artifacts", filename);
      await writeJsonAtomically(artifactPath, payload);
      const bytes = await fsp.readFile(artifactPath);
      const timestamp = this.now();
      const next = clone(current);
      const resource = {
        resourceId,
        type: definition.type,
        createdByTask: true,
        locator: {
          path: path.posix.join("artifacts", filename),
          sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
          ...(options.sourceSha256 ? { sourceSha256: options.sourceSha256 } : {}),
        },
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
        cleanup: { policy: "DELETE_AFTER_LOG_RETENTION", required: false, status: "PENDING", completedAt: null },
      };
      next.resources.items.push(resource);
      next[definition.pointer[0]][definition.pointer[1]] = resourceId;
      next.documentRevision += 1;
      next.updatedAt = timestamp;
      await this.writeState(next);
      return { state: clone(next), resource: clone(resource) };
    });
  }

  async saveCandidateData(taskId, expectedDocumentRevision, candidate) {
    return this.saveJsonArtifact(taskId, expectedDocumentRevision, "candidate", candidate);
  }

  async restoreCandidateBaseline(taskId, expectedDocumentRevision, baseline) {
    return this.saveJsonArtifact(taskId, expectedDocumentRevision, "candidate-restore", baseline);
  }

  async recordIngress(taskId, expectedDocumentRevision, ingress) {
    if (!ingress || typeof ingress !== "object" || typeof ingress.requestId !== "string" || typeof ingress.route?.messageId !== "string") {
      throw new TaskStoreInvariantError("IngressRequest 不完整");
    }
    return this.withTaskLock(taskId, async () => {
      const current = await this.readTask(taskId);
      if (current.documentRevision !== expectedDocumentRevision) {
        throw new CompareAndSwapError(
          `ingress revision 不匹配：期望 ${expectedDocumentRevision}，实际 ${current.documentRevision}`,
        );
      }
      if (current.operator?.feishuOpenId !== ingress.operator?.feishuOpenId) {
        throw new TaskStoreInvariantError("IngressRequest operator 与 task 不匹配");
      }
      if (!current.routing || current.routing.chatId !== ingress.route.chatId || current.routing.triggerMessageId !== ingress.route.triggerMessageId) {
        throw new TaskStoreInvariantError("IngressRequest route 与 task 不匹配");
      }
      const messageId = ingress.route.messageId;
      const existing = current.resources.items.find((item) => item.locator?.messageId === messageId);
      if (existing) return { deduplicated: true, state: clone(current), resource: clone(existing) };

      const digest = crypto.createHash("sha256").update(messageId).digest("hex");
      const resourceId = `res_ingress_${digest.slice(0, 16)}`;
      const filename = `ingress-${digest}.json`;
      const artifactPath = path.join(this.taskDirectory(taskId), "artifacts", filename);
      await writeJsonAtomically(artifactPath, ingress);
      const bytes = await fsp.readFile(artifactPath);
      const timestamp = this.now();
      const next = clone(current);
      const resource = {
        resourceId,
        type: "TEMP_FILE",
        createdByTask: true,
        locator: {
          path: path.posix.join("artifacts", filename),
          messageId,
          sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
        },
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
        cleanup: { policy: "DELETE_AFTER_LOG_RETENTION", required: false, status: "PENDING", completedAt: null },
      };
      next.resources.items.push(resource);
      next.routing.lastInboundMessageId = messageId;
      next.documentRevision += 1;
      next.updatedAt = timestamp;
      await this.writeState(next);
      return { deduplicated: false, state: clone(next), resource: clone(resource) };
    });
  }

  async activateIngress(taskId, messageId) {
    if (typeof messageId !== "string" || !messageId) throw new TaskStoreInvariantError("待激活 ingress messageId 非法");
    return this.withTaskLock(taskId, async () => {
      const current = await this.readTask(taskId);
      const resource = current.resources.items.find((item) => item.locator?.messageId === messageId);
      if (!resource?.locator?.path) throw new TaskStoreInvariantError("待激活 ingress resource 缺失");
      const next = clone(current);
      next.routing.currentTurnMessageId = messageId;
      next.documentRevision += 1;
      next.updatedAt = this.now();
      await this.writeState(next);
      return { state: clone(next), resource: clone(resource) };
    });
  }

  async readCurrentIngress(taskId) {
    const state = await this.readTask(taskId);
    const messageId = state.routing?.currentTurnMessageId;
    if (!messageId) throw new TaskStoreInvariantError("task 没有已激活的 current turn ingress");
    const resource = state.resources.items.find((item) => item.locator?.messageId === messageId);
    if (!resource?.locator?.path) throw new TaskStoreInvariantError("current turn ingress resource 缺失");
    const artifactPath = path.join(this.taskDirectory(taskId), ...resource.locator.path.split("/"));
    return { state, ingress: await readJson(artifactPath), resource: clone(resource) };
  }

  async recordPiSession(taskId, expectedDocumentRevision, session) {
    if (!session || typeof session.piSessionId !== "string" || !session.piSessionId || typeof session.sessionFile !== "string" || !session.sessionFile) {
      throw new TaskStoreInvariantError("PI session 信息不完整");
    }
    return this.updateState(taskId, expectedDocumentRevision, (state) => {
      const resourceId = `res_pi_session_${state.lifecycle.attempt || 1}`;
      if (state.resources.items.some((item) => item.resourceId === resourceId)) {
        throw new TaskStoreInvariantError(`PI session 已登记：${resourceId}`);
      }
      const timestamp = this.now();
      state.resources.items.push({
        resourceId,
        type: "PI_SESSION",
        createdByTask: true,
        locator: {
          piSessionId: session.piSessionId,
          sessionFile: session.sessionFile,
          sessionKey: session.sessionKey,
        },
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
        cleanup: { policy: "MANUAL_RETENTION", required: false, status: "PENDING", completedAt: null },
      });
      if (!state.routing || typeof state.routing !== "object") state.routing = {};
      state.routing.piSessionResourceId = resourceId;
      return state;
    });
  }

  async endTask(taskId, expectedDocumentRevision, finalResult = "ENDED") {
    const state = await this.updateState(taskId, expectedDocumentRevision, (next) => {
      next.lifecycle.state = "ENDED";
      next.lifecycle.finalResult = finalResult;
      return next;
    });
    await this.releaseMutationLock(taskId);
    return state;
  }

  async scanNonEndedTasks() {
    const entries = await fsp.readdir(this.tasksRoot(), { withFileTypes: true });
    const states = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !TASK_ID_PATTERN.test(entry.name)) continue;
      const state = await this.readTask(entry.name);
      if (state.lifecycle.state !== "ENDED") states.push(state);
    }
    return states.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async recoverActiveTask() {
    const active = await this.scanNonEndedTasks();
    if (active.length > 1) {
      throw new TaskStoreInvariantError("发现多个非 ENDED task，拒绝自动恢复");
    }
    const owner = await this.readMutationLockOwner();
    if (active.length === 0) {
      if (owner) throw new TaskStoreInvariantError(`没有 active task 但 mutation lock 仍属于 ${owner.taskId}`);
      return null;
    }
    const task = active[0];
    if (!owner) {
      await this.acquireMutationLock(task.taskId, this.now(), true);
    } else if (owner.taskId !== task.taskId) {
      throw new TaskStoreInvariantError(`mutation lock 属于 ${owner.taskId}，active task 是 ${task.taskId}`);
    }
    return task;
  }

  async acquireMutationLock(taskId, acquiredAt = this.now(), recovered = false) {
    assertTaskId(taskId);
    const lockDirectory = this.globalLockDirectory();
    const made = await mkdirExclusive(lockDirectory);
    if (!made) {
      // 另一个创建者可能刚 mkdir、尚未写完 owner.json；这一短窗口也必须视为 busy，
      // 不能把内部不完整状态暴露为可让第二个 task 继续创建的错误。
      let owner = null;
      try {
        owner = await this.readMutationLockOwner();
      } catch (error) {
        if (!(error instanceof TaskStoreInvariantError)) throw error;
      }
      throw new MutationLockBusyError(`全局 mutation lock 已被占用：${owner ? owner.taskId : "未知 owner"}`);
    }
    try {
      await writeJsonAtomically(path.join(lockDirectory, OWNER_FILE), {
        taskId,
        acquiredAt,
        recovered,
      });
    } catch (error) {
      await fsp.rm(lockDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async readMutationLockOwner() {
    try {
      const owner = await readJson(path.join(this.globalLockDirectory(), OWNER_FILE));
      assertTaskId(owner.taskId);
      return owner;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        const exists = await fsp.stat(this.globalLockDirectory()).then(() => true).catch(() => false);
        if (!exists) return null;
        throw new TaskStoreInvariantError("mutation lock 缺少 owner.json");
      }
      if (error instanceof TaskStoreInvariantError) throw error;
      throw new TaskStoreInvariantError("mutation lock owner.json 损坏");
    }
  }

  async releaseMutationLock(taskId) {
    const owner = await this.readMutationLockOwner();
    if (!owner) return false;
    if (owner.taskId !== taskId) {
      throw new TaskStoreInvariantError(`拒绝释放其他 task 的 mutation lock：${owner.taskId}`);
    }
    await fsp.rm(this.globalLockDirectory(), { recursive: true, force: false });
    await fsyncDirectory(this.runtimeRoot);
    return true;
  }

  async withTaskLock(taskId, operation) {
    const directory = this.taskDirectory(taskId);
    const lockDirectory = path.join(directory, ".state.lock");
    const deadline = Date.now() + 2000;
    while (!(await mkdirExclusive(lockDirectory))) {
      if (Date.now() >= deadline) throw new TaskStoreInvariantError(`task state lock 超时：${taskId}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    try {
      return await operation();
    } finally {
      await fsp.rmdir(lockDirectory).catch(() => {});
    }
  }

  async writeState(state) {
    this.assertState(state, state.taskId);
    await writeJsonAtomically(this.statePath(state.taskId), state, {
      beforeRename: this.beforeStateRename,
    });
  }

  assertState(state, taskId) {
    if (!state || typeof state !== "object") throw new TaskStoreInvariantError("state 必须是对象");
    if (state.taskId !== taskId) throw new TaskStoreInvariantError("state taskId 不匹配");
    if (!Number.isInteger(state.documentRevision) || state.documentRevision < 1) {
      throw new TaskStoreInvariantError("state documentRevision 非法");
    }
    if (!state.lifecycle || typeof state.lifecycle.state !== "string" || !Number.isInteger(state.lifecycle.stateVersion)) {
      throw new TaskStoreInvariantError("state lifecycle 非法");
    }
  }
}

module.exports = {
  CompareAndSwapError,
  MutationLockBusyError,
  RuntimeRootError,
  TaskStore,
  TaskStoreError,
  TaskStoreInvariantError,
  generateTaskId,
  writeJsonAtomically,
};
