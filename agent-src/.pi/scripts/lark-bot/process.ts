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
  IS_WIN,
  LOG_FILE,
  LOG_MAX_BYTES,
  LOG_KEEP_BACKUPS,
  PID_FILE,
  PROJECT_DIR,
  SESSION_ACTIVE_THRESHOLD_MS,
  SESSION_KEEP_PER_CHAT,
  SESSION_MAX_AGE_DAYS,
} from "./config.js";

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
