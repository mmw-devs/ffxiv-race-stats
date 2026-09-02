/**
 * process.ts — L5 Process 层
 *
 * SSOT 视角：进程级运维关切（PID、日志轮转、文件清理、看门狗、信号处理）
 * 集中在此；不持有任何业务状态。
 *
 * 设计说明：本模块被 shared/logger.ts 单向引用（rotateLogIfNeeded），
 * 因此本模块不能再 import shared/logger，否则循环依赖。
 * 业务模块如需打日志应 import { log } from "../shared/logger.js"。
 */

import { execSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import {
  CRASH_LOG_PREFIX,
  HEAP_PRESSURE_MB,
  HEARTBEAT_INTERVAL_MS,
  IS_WIN,
  LOG_FILE,
  LOG_MAX_BYTES,
  LOG_KEEP_BACKUPS,
  PID_FILE,
  PROJECT_DIR,
  RESTART_HISTORY_FILE,
  RESTART_STORM_COOLDOWN_MS,
  RESTART_STORM_MAX,
  RESTART_STORM_WINDOW_MS,
  SESSION_ACTIVE_THRESHOLD_MS,
  SESSION_KEEP_PER_CHAT,
  SESSION_MAX_AGE_DAYS,
} from "./config.js";

/** 累计某目录下所有文件大小（递归），用于心跳报告磁盘占用。 */
function dirSizeBytes(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      try {
        const st = statSync(p);
        if (e.isDirectory()) {
          const sub = dirSizeBytes(p);
          files += sub.files;
          bytes += sub.bytes;
        } else {
          files++;
          bytes += st.size;
        }
      } catch {}
    }
  } catch {}
  return { files, bytes };
}

// ═══════════════ 日志轮转（被 logger 单向调用） ═══════════════

export function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const stats = statSync(LOG_FILE);
    if (stats.size < LOG_MAX_BYTES) return;
    try { unlinkSync(`${LOG_FILE}.${LOG_KEEP_BACKUPS}`); } catch {}
    for (let i = LOG_KEEP_BACKUPS - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      try { if (existsSync(src)) renameSync(src, dst); } catch {}
    }
    try { renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch {}
  } catch {}
}

// ═══════════════ 进程级崩溃防护（R1 L5） ═══════════════

/**
 * 安装 uncaughtException + unhandledRejection 处理器。
 *
 * 设计目的：让崩溃成为可观察的、有日志的、能让 supervisor 重启的明确事件。
 * 行为：
 *   - 记录结构化日志（含 stack）
 *   - 以 non-zero 退出码退出（systemd 看到非 0 退出才会触发 Restart=always）
 *   - 不静默吞掉：吞掉会导致 Node 进程处于「坏状态」继续运行，后续行为不可预测
 *
 * 必须由 main() 在启动期调用，且只能调用一次（重复调用会覆盖前面的 handler）。
 */
export function installCrashHandlers(onCrash: (kind: "uncaughtException" | "unhandledRejection", err: unknown) => void): void {
  process.on("uncaughtException", (err) => {
    onCrash("uncaughtException", err);
  });
  process.on("unhandledRejection", (reason) => {
    onCrash("unhandledRejection", reason);
  });
}

/**
 * 追加一条崩溃日志到 LOG_FILE（不依赖 shared/logger，避免 logger 在异常路径下二次失败）。
 * 使用 appendFileSync 而非 writeFileSync，保证日志不丢。
 */
export function appendCrashLog(kind: "uncaughtException" | "unhandledRejection", err: unknown): void {
  const ts = new Date().toISOString();
  const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const line = `[${ts}] ${CRASH_LOG_PREFIX} ${kind}: ${stack}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
  // 同步输出到 stderr，让 systemd journald 也能看到
  try { process.stderr.write(line); } catch {}
}

// ═══════════════ 心跳与内存监控（R1 L5） ═══════════════

/**
 * 启动心跳定时器：周期性输出 lark-bot 存活信号 + 关键指标。
 *
 * 作用：长跑场景下（数天不重启），运维侧需要「确认进程是否真的活着」的简单手段。
 * 比「最近一次日志距今多久」更可靠——因为心跳即使在零消息时也会输出。
 *
 * 报告的指标：
 *   - uptime / heap / rss（内存）
 *   - logSize（/tmp/lark-bot.log 当前大小，MB）
 *   - sessionDirSize（.pi/sessions/ 文件数 + 总大小）
 *   - getStats() 返回的业务状态（由 main.ts 注入）
 *
 * getStats 由调用方注入，避免 process.ts 反向依赖 interactive 模块。
 */
export function startHeartbeat(getStats: () => Record<string, unknown>): NodeJS.Timeout {
  return setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);

    // 磁盘占用：日志文件 + session 目录（盲区 #2 修复）
    let logSizeMB = 0;
    try {
      if (existsSync(LOG_FILE)) logSizeMB = Math.round(statSync(LOG_FILE).size / 1024 / 1024);
    } catch {}
    const sessionDir = join(PROJECT_DIR, ".pi", "sessions");
    const sessionsUsage = dirSizeBytes(sessionDir);

    const stats = getStats();
    const line = `💓 heartbeat uptime=${Math.round(process.uptime())}s heap=${heapMB}MB rss=${rssMB}MB log=${logSizeMB}MB sessions=${sessionsUsage.files}f/${Math.round(sessionsUsage.bytes / 1024 / 1024)}MB ${JSON.stringify(stats)}`;
    try {
      appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
    } catch {}
    // 内存压力告警：超过阈值时输出醒目日志（不主动重启，避免状态丢失）
    if (heapMB > HEAP_PRESSURE_MB) {
      const warn = `⚠️ [memory pressure] heap=${heapMB}MB 超过软阈值 ${HEAP_PRESSURE_MB}MB`;
      try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${warn}\n`); } catch {}
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// ═══════════════ 重启风暴保护（R1 L5） ═══════════════

/**
 * 启动期检查是否处于「重启风暴」状态。
 *
 * 场景：lark-bot 启动后立即崩溃 → 被 supervisor 拉起 → 再崩 → 再拉起 → 资源耗尽。
 * 防护：维护 /tmp/lark-bot.restart-history 记录最近 N 秒内的启动时间戳，
 * 若超过 RESTART_STORM_MAX 次则暂停 RESTART_STORM_COOLDOWN_MS 不启动。
 *
 * 返回值：
 *   - "ok"：可正常启动
 *   - "cooldown"：处于冷却期，应直接 process.exit(0) 让 supervisor 等待重试
 *
 * 调用时机：main() 启动期，PID 单例校验之后、startAllPi 之前。
 */
export function checkRestartStorm(): "ok" | "cooldown" {
  const now = Date.now();
  const windowStart = now - RESTART_STORM_WINDOW_MS;

  let history: number[] = [];
  try {
    if (existsSync(RESTART_HISTORY_FILE)) {
      const raw = readFileSync(RESTART_HISTORY_FILE, "utf-8").trim();
      history = raw ? raw.split("\n").map(Number).filter(n => Number.isFinite(n)) : [];
    }
  } catch {}

  // 过滤掉窗口外的旧记录
  history = history.filter(ts => ts >= windowStart);

  if (history.length >= RESTART_STORM_MAX) {
    // 处于风暴中：最后一次启动距今 < 冷却窗口，拒绝启动
    const lastStart = history[history.length - 1] ?? now;
    if (now - lastStart < RESTART_STORM_COOLDOWN_MS) {
      try {
        appendFileSync(
          LOG_FILE,
          `[${new Date().toISOString()}] ⛔ restart storm: ${history.length} restarts in ${RESTART_STORM_WINDOW_MS}ms, cooling down\n`,
        );
      } catch {}
      return "cooldown";
    }
    // 冷却已过：清空历史，正常启动
    history = [];
  }

  // 记录本次启动时间戳
  history.push(now);
  try {
    writeFileSync(RESTART_HISTORY_FILE, history.join("\n") + "\n");
  } catch {}
  return "ok";
}

// ═══════════════ 进程存活检测 ═══════════════

/** Windows: tasklist /FO CSV /NH → 解析第二列 PID；非 Windows: process.kill(pid, 0) */
export function isAlive(pid: number): boolean {
  if (IS_WIN) {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
        encoding: "utf-8",
      });
      for (const line of out.trim().split("\n")) {
        // CSV 格式: "进程名","PID","会话名","会话#","内存使用"
        const cols = line.match(/"([^"]*)"/g);
        if (cols && cols.length >= 2 && cols[1].replace(/"/g, "") === String(pid)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ═══════════════ PID 文件 ═══════════════

/** 启动期单例校验：若已有运行中的 lark-bot 则退出。 */
export function checkExistingPid(): boolean {
  if (!existsSync(PID_FILE)) return false;
  try {
    const oldPid = Number(readFileSync(PID_FILE, "utf-8").trim());
    if (oldPid > 0 && isAlive(oldPid)) return true;
  } catch {}
  return false;
}

export function writePidFile(pid: number): void {
  writeFileSync(PID_FILE, String(pid));
}

export function clearPidFile(): void {
  try { unlinkSync(PID_FILE); } catch {}
}

/** 注册 process.on("exit") — Node 保证在退出前最后调用 */
export function onExitCleanup(handler: () => void): void {
  process.on("exit", handler);
}

// ═══════════════ 看门狗 ═══════════════

/**
 * 启动 5s 周期看门狗：监控一组 PID，任一退出则调用 onTargetExit。
 *   - DIRECT_PARENT (process.ppid)：tsx CLI
 *   - LARK_PARENT_PID (env)：PI Agent
 * 任一死则触发清理退出。
 *
 * 设计说明：依赖 OS PID 生命周期，未引入 PID identity 校验。
 *          PID reuse 在 5s 间隔 + 现代 OS 分配策略下概率极低。
 */
export function startWatchdog(
  targetPids: number[],
  onTargetExit: (deadPid: number) => void,
): NodeJS.Timeout {
  return setInterval(() => {
    for (const pid of targetPids) {
      if (!isAlive(pid)) {
        onTargetExit(pid);
        return;
      }
    }
  }, 5000);
}

// ═══════════════ 信号处理 ═══════════════

export function installSignalHandlers(handler: () => void): void {
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

// ═══════════════ Extension stdin IPC shutdown ═══════════════

/**
 * Extension 通过 stdin pipe 发送 {"type":"shutdown"}，触发优雅退出。
 * 解决 Windows 下 subprocess.kill("SIGTERM") = TerminateProcess（硬杀）
 * 导致 cleanup() 和 process.on("exit") 都不执行、PID_FILE 残留的问题。
 */
export function installStdinShutdown(handler: () => void): void {
  process.stdin.on("data", (d: Buffer) => {
    try {
      if (JSON.parse(d.toString("utf-8")).type === "shutdown") handler();
    } catch {}
  });
}

// ═══════════════ session 文件清理 ═══════════════

/**
 * 定期清理 .pi/sessions/bot-* 下旧的 jsonl 文件。
 *   - 超过 SESSION_KEEP_PER_CHAT 的最旧文件
 *   - 超过 SESSION_MAX_AGE_DAYS 的文件
 *   - 但最近 SESSION_ACTIVE_THRESHOLD_MS 内活跃的保留
 */
export function cleanupOldSessions(): void {
  const sessionRoot = join(PROJECT_DIR, ".pi", "sessions");
  const now = Date.now();
  const maxAgeMs = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    const chatDirs = readdirSync(sessionRoot);
    for (const chatDir of chatDirs) {
      const dirPath = join(sessionRoot, chatDir);
      let st;
      try { st = statSync(dirPath); } catch { continue; }
      if (!st.isDirectory()) continue;
      const entries = readdirSync(dirPath)
        .filter(f => f.endsWith(".jsonl"))
        .map(f => {
          const p = join(dirPath, f);
          let mt = 0;
          try { mt = statSync(p).mtimeMs; } catch {}
          return { name: f, path: p, mtime: mt };
        })
        .sort((a, b) => b.mtime - a.mtime);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const isBeyondKeep = i >= SESSION_KEEP_PER_CHAT;
        const isTooOld = (now - e.mtime) > maxAgeMs;
        const isRecent = (now - e.mtime) < SESSION_ACTIVE_THRESHOLD_MS;
        if ((isBeyondKeep || isTooOld) && !isRecent) {
          try { unlinkSync(e.path); removed++; } catch {}
        }
      }
    }
  } catch {}
  if (removed > 0) {
    console.log(`🧹 [session cleanup] removed ${removed} old files (>${SESSION_MAX_AGE_DAYS}d or beyond top-${SESSION_KEEP_PER_CHAT})`);
  }
}
