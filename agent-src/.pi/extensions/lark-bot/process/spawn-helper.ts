/**
 * extensions/lark-bot/process/spawn-helper.ts
 *
 * 依据：issue #168 第一阶段 N4 §3.2.1 + 实测 2 + 实测 6-6
 *   "spawn `pi --mode rpc` NDJSON 协议稳定（33 种命令），
 *    stdin.end() 触发干净退出（exitCode: 0）—— 必须保留"
 *
 * 职责（PR-1：从 agent-src/.pi/scripts/lark-bot/process.ts 抽出）：
 *   1. spawn pi --mode rpc --session-dir <chatId>
 *   2. PID 管理（spawn mutex 防并发——保留 session-manager.ts spawnPromises）
 *   3. stdin shutdown（实测 6-6 验证 stdin.end() 干净退出）
 *   4. per-session 重启风暴防护（5min/10次）
 *
 * 不负责（移交 systemd / 已在 PR-1 删除）：
 *   - 进程级 restart storm（process.ts checkRestartStorm → systemd 接管）
 *   - 心跳（process.ts startHeartbeat → systemd 接管）
 *   - 看门狗（process.ts startWatchdog → systemd 接管）
 *   - PID 文件（process.ts writePidFile/clearPidFile → 不再有独立进程）
 *   - 信号处理（process.ts installSignalHandlers → 不再有独立进程）
 *
 * 约束（实测 5）：
 *   - module-level state 仅使用 Map.set / Map.get / Map.delete 等原子操作
 *   - 禁止 check-then-act 跨 await
 *
 * 约束（实测 6-3）：
 *   - spawn 出来的子进程必须由调用方通过 children-registry.ts 注册
 *   - 本模块不直接调用 trackChild，保持职责单一
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  IS_WIN,
  PI_BIN,
  PI_RESTART_MAX,
  PI_RESTART_WINDOW_MS,
  PROJECT_DIR,
} from "../../../scripts/lark-bot/config.js";
import { log } from "../../../scripts/lark-bot/shared/logger.js";
import { join } from "node:path";

// ═══════════════ 类型定义 ═══════════════

/** spawn pi 子进程的参数 */
export interface SpawnPiOptions {
  /** 业务 session key（如 "bot-p2p-<chatId>"），仅用于日志/调试 */
  sessionKey: string;
  /** 飞书 chat_id，用于推导 sessionDir */
  chatId: string;
  /** 可选 cwd，默认 PROJECT_DIR */
  cwd?: string;
}

/** spawn 返回的 pi 子进程句柄 */
export interface SpawnedPi {
  proc: ChildProcess;
  sessionKey: string;
  sessionDir: string;
  spawnedAt: number;
}

/** per-session restart 计数（实测 6-6：独立 per-session，进程级风暴由 systemd 接管） */
export interface PiRestartState {
  timestamps: number[];
  deathReason: string;
  lastSpawnedAt: number;
}

/** spawn mutex 项：同一 sessionKey 并发 ensureSession 复用同一 Promise */
interface SpawnPromiseEntry {
  promise: Promise<SpawnedPi>;
  resolve: (pi: SpawnedPi) => void;
  reject: (err: Error) => void;
}

// ═══════════════ Module-level 状态（实测 5：原子操作安全） ═══════════════

/** per-sessionKey 的 spawn Promise 链（commit 4 引入，PR-1 保留并搬移） */
const spawnPromises = new Map<string, SpawnPromiseEntry>();

/** per-session restart 状态 */
const restartStates = new Map<string, PiRestartState>();

// ═══════════════ spawn mutex（commit 4 缓解竞态） ═══════════════

/**
 * 同一 sessionKey 的并发 spawn 复用同一 Promise。
 * spawn 完成后自动清理 entry，避免内存泄漏。
 *
 * PR-1-cleanup：PR-1 阶段为孤岛 API（session-manager.ts 未迁移）。PR-2 启用 registerTool
 * 拉取模式时，session-manager.ts 切到本 API；在此之前请勿在新代码中使用。
 *
 * 用法：
 *   try {
 *     const { promise } = getOrCreateSpawnEntry(key);
 *     const pi = await promise;
 *   } finally {
 *     clearSpawnEntry(key);
 *   }
 *
 * @deprecated PR-1 阶段 session-manager.ts 仍用内联 spawn mutex；PR-2 切到本 API 后取消标注。
 */
export function getOrCreateSpawnEntry(sessionKey: string): SpawnPromiseEntry {
  // 单步原子读——实测 5 允许
  const existing = spawnPromises.get(sessionKey);
  if (existing) return existing;

  // 占位 entry：resolve/reject 由 spawn 完成后填入
  let resolve!: (pi: SpawnedPi) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<SpawnedPi>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const entry: SpawnPromiseEntry = { promise, resolve, reject };
  spawnPromises.set(sessionKey, entry);
  return entry;
}

/** spawn 完成后清理 entry（单步原子） */
export function clearSpawnEntry(sessionKey: string): void {
  spawnPromises.delete(sessionKey);
}

// ═══════════════ spawn pi 子进程 ═══════════════

/**
 * spawn `pi --mode rpc --session-dir <chatId>`。
 *
 * 不含 stdin/stdout NDJSON 解析——本模块仅 spawn。
 * NDJSON 解析仍由 session-manager.ts 拥有（PR-1 不动）。
 *
 * PR-1-cleanup：PR-1 阶段为孤岛 API（session-manager.ts 未迁移到本 API）。
 * PR-2 启用 registerTool 拉取模式时，session-manager.ts 切到本 API。
 *
 * @returns SpawnedPi 包含 proc / sessionKey / sessionDir / spawnedAt
 *
 * @deprecated PR-1 阶段 session-manager.ts 仍用内联 spawn；PR-2 切到本 API 后取消标注。
 */
export function spawnPi(opts: SpawnPiOptions): SpawnedPi {
  const { sessionKey, chatId, cwd = PROJECT_DIR } = opts;
  // sessionDir 格式：.pi/sessions/bot-p2p-<chatId>/
  // chatId 含 ":" 时替换为 "-"（lark-cli 路径安全）
  const safeChatId = chatId.replace(/:/g, "-");
  const sessionDir = join(PROJECT_DIR, ".pi", "sessions", `bot-p2p-${safeChatId}`);

  const proc = spawn(
    PI_BIN,
    ["--mode", "rpc", "--session-dir", sessionDir],
    {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LARK_BOT_RUNTIME: "1" },
      shell: IS_WIN,
    },
  );

  const spawned: SpawnedPi = {
    proc,
    sessionKey,
    sessionDir,
    spawnedAt: Date.now(),
  };

  log(`[pi:${sessionKey.slice(-12)}] spawn 完成 (pid=${proc.pid ?? "?"}) sessionDir=${sessionDir}`);

  // 更新 per-session restart state
  const state = restartStates.get(sessionKey) ?? {
    timestamps: [],
    deathReason: "",
    lastSpawnedAt: 0,
  };
  state.lastSpawnedAt = spawned.spawnedAt;
  restartStates.set(sessionKey, state);

  return spawned;
}

// ═══════════════ restart storm 防护（per-session，实测 6-6） ═══════════════

/**
 * 记录本次重启时间戳，检查是否处于 per-session 重启风暴。
 *
 * 阈值：PI_RESTART_WINDOW_MS（5min）内 PI_RESTART_MAX（10）次
 * 超阈值返回 "cooldown"，调用方应停止重试。
 *
 * 返回值：
 *   - "ok"：可继续 spawn
 *   - "cooldown"：处于冷却期，应停止重试
 *
 * 注：进程级 restart storm（process.ts checkRestartStorm）已删除，
 * 由 systemd / pm2 接管。本函数仅 per-session。
 */
export function recordPiRestart(sessionKey: string, deathReason: string): "ok" | "cooldown" {
  const now = Date.now();
  const windowStart = now - PI_RESTART_WINDOW_MS;

  // 单步原子读——实测 5 允许
  let state = restartStates.get(sessionKey);
  if (!state) {
    state = { timestamps: [], deathReason: "", lastSpawnedAt: 0 };
  }

  // 过滤窗口外时间戳
  state.timestamps = state.timestamps.filter((ts) => ts >= windowStart);
  state.deathReason = deathReason;
  state.timestamps.push(now);

  // 单步原子写
  restartStates.set(sessionKey, state);

  if (state.timestamps.length > PI_RESTART_MAX) {
    log(`🛑 [${sessionKey}] pi 重启风暴：${PI_RESTART_WINDOW_MS / 1000}s 内 ${state.timestamps.length} 次 > ${PI_RESTART_MAX}。原因：${deathReason}`);
    return "cooldown";
  }

  return "ok";
}

/** 取 per-session 重启状态（心跳 / 调试用） */
export function getPiRestartStats(): Record<string, { count: number; reason: string; lastSpawnedAt: number }> {
  const out: Record<string, { count: number; reason: string; lastSpawnedAt: number }> = {};
  for (const [key, state] of restartStates) {
    out[key.slice(-12)] = {
      count: state.timestamps.length,
      reason: state.deathReason,
      lastSpawnedAt: state.lastSpawnedAt,
    };
  }
  return out;
}

// ═══════════════ 子进程 exit 监听（薄封装） ═══════════════

/**
 * 监听 spawn 出来的 pi 子进程 exit 事件。
 * 调用方负责在 onExit 回调里：
 *   1. 调 recordPiRestart() 更新计数
 *   2. 决定是否 spawnPi() 重试
 *   3. 调 children-registry.ts 的 cleanup（实测 6-3）
 *
 * 本函数仅做"exit 事件 → 回调"的薄封装，方便单测 mock。
 *
 * PR-1-cleanup：PR-1 阶段为孤岛 API（session-manager.ts 未迁移）。
 * PR-2 启用 registerTool 拉取模式时，session-manager.ts 切到本 API。
 *
 * @deprecated PR-1 阶段 session-manager.ts 仍用内联 watchPiExit；PR-2 切到本 API 后取消标注。
 */
export function watchPiExit(spawned: SpawnedPi, onExit: (code: number | null) => void): void {
  spawned.proc.on("exit", (code) => {
    log(`[pi:${spawned.sessionKey.slice(-12)}] exit (code=${code})`);
    onExit(code);
  });
  spawned.proc.on("error", (err) => {
    log(`[pi:${spawned.sessionKey.slice(-12)}] error: ${err.message}`);
  });
}

// ═══════════════ stdin shutdown（实测 6-6 验证） ═══════════════

/**
 * 注册 stdin shutdown handler（实测 6-6 验证 stdin.end() exitCode=0）。
 *
 * 用法（lark-bot 主进程或 extension 注册）：
 *   installStdinShutdown(() => {
 *     cleanup();
 *     process.exit(0);
 *   });
 *
 * Extension 通过 stdin pipe 发送 `{"type":"shutdown"}` 触发 lark-bot 优雅退出。
 * 解决 Windows 下 subprocess.kill("SIGTERM") = TerminateProcess 硬杀，
 * 导致 cleanup() 和 process.on("exit") 都不执行的问题。
 *
 * 约束（实测 5）：
 *   - JSON 解析失败静默吞掉（协议层仅做"识别 shutdown"，不抛错）
 */
export function installStdinShutdown(handler: () => void): void {
  process.stdin.on("data", (d: Buffer) => {
    try {
      if (JSON.parse(d.toString("utf-8")).type === "shutdown") handler();
    } catch {
      // 静默吞掉——非 shutdown 消息不应触发 handler
    }
  });
}

// ═══════════════ 进程级 restart history ═══════════════

// 进程级 restart history 文件由 scripts/lark-bot/interactive/session-manager.ts 写入
// （per-session pi 子进程重启事件，appendFileSync 到 /tmp/lark-bot.pi-restart-history）。
// PR-1-cleanup：原 `recordPiRestartHistoryLegacy()` 全局函数已删除。
// 如需查看 per-process 重启历史，使用 systemd journalctl 或 /tmp/lark-bot.pi-restart-history。
