/**
 * main.ts — lark-bot 进程入口
 *
 * 装配：读取 config → 启动日志 → 启动 p2p session → 启动飞书事件流 → 安装运维关切
 *
 * 「群聊=广播」重构后的精简启动序列：
 *   - startAllPi() 仅启动 "p2p" 一个 session（不再批量启动 group:<chat_id>）
 *   - 不再调用 lark-cli GET /open-apis/im/v1/chats（无群聊列表需求）
 *   - 不再启动 pollActiveThreads 周期任务（轮询兜底已剔除）
 *
 * 这是 SSOT 结构下的"装配点"：所有跨模块的初始化与生命周期挂钩在这里。
 * 没有业务逻辑（业务逻辑在 ingress / protocol / interactive）。
 *
 * 用法: tsx main.ts
 */

import {
  appendCrashLog,
  checkExistingPid,
  checkRestartStorm,
  clearPidFile,
  cleanupOldSessions,
  installCrashHandlers,
  installSignalHandlers,
  installStdinShutdown,
  onExitCleanup,
  startHeartbeat,
  startWatchdog,
  writePidFile,
} from "./process.js";
import { HEAP_HARD_LIMIT_MB, SESSION_EVICTION_INTERVAL_MS } from "./config.js";
import { log } from "./shared/logger.js";
import {
  cleanupSeenMessageIds,
  enforceSessionLimit,
  evictIdleSessions,
  getAllSessions,
  getPiRestartStats,
  startAllPi,
  killAllSessions,
} from "./interactive/session-manager.js";
import { handleLarkEvent } from "./ingress.js";
import { startLarkEvents } from "./protocol/feishu.js";

// 触发 ingress 模块的副作用（注册 60s 周期清理）
import "./ingress.js";

// ═══════════════ 启动 ═══════════════

function main(): void {
  // R1 L5：uncaughtException / unhandledRejection 必须在 PID 校验前安装
  // 防止启动期崩溃时无 handler
  installCrashHandlers((kind, err) => {
    appendCrashLog(kind, err);
    log(`💥 ${kind}: ${err instanceof Error ? err.message : String(err)}`);
    cleanup();
    // 以非零退出码退出，systemd / pm2 看到非 0 才会拉起新进程
    process.exit(1);
  });

  // R1 L5：重启风暴检查。PID 校验之后、写入新 PID 之前。
  // 如果处于冷却期，直接退出让 supervisor 等待重试间隔
  const restartState = checkRestartStorm();
  if (restartState === "cooldown") {
    log("⛔ 处于重启风暴冷却期，拒绝启动");
    process.exit(0);
  }

  // 启动期 PID 校验：使用 isAlive() 确保 Windows 下也能准确检测
  if (checkExistingPid()) {
    log("已在运行（PID 文件存在且进程存活）");
    process.exit(0);
  }
  writePidFile(process.pid);
  log("════════ lark-bot 启动 ════════");

  // commit 4：startAllPi 为空操作（per-p2p session 懒启动）
  startAllPi();
  // WS 事件流：群聊事件由 ingress 丢弃；handleLarkEvent 是 async，fire-and-forget
  startLarkEvents((event) => { void handleLarkEvent(event); });

  // session 文件清理（保留，每 24h 一次）
  setTimeout(() => cleanupOldSessions(), 60 * 1000);
  setInterval(cleanupOldSessions, 24 * 60 * 60 * 1000);

  // commit 4：周期性 session 淘汰（空闲超时 + 数量上限）
  setInterval(() => {
    const idle = evictIdleSessions();
    const lru = enforceSessionLimit();
    if (idle.evicted > 0 || lru.evicted > 0) {
      log(`🧹 [session 淘汰] idle=${idle.evicted} lru=${lru.evicted} 当前 sessions=${getAllSessions().length}`);
    }
  }, SESSION_EVICTION_INTERVAL_MS);

  // R1 L5：心跳定时器。getStats 由 main.ts 注入避免 process.ts 反向依赖 session-manager
  startHeartbeat(() => {
    const stats: Record<string, unknown> = {
      sessions: getAllSessions().map(pi => ({
        proc: pi.proc ? "alive" : "dead",
        waitingTasks: pi.waitingTasks.length,
        seen: pi.seenMessageIds.size,
        ready: pi.ready,
      })),
      piRestarts: getPiRestartStats(),
    };

    // 盲区 #3 防护：硬内存上限触发主动清理
    const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    if (heapMB > HEAP_HARD_LIMIT_MB) {
      const before = getAllSessions().reduce((s, p) => s + p.seenMessageIds.size, 0);
      const r = cleanupSeenMessageIds();
      const after = getAllSessions().reduce((s, p) => s + p.seenMessageIds.size, 0);
      log(`🚨 [hard memory] heap=${heapMB}MB > ${HEAP_HARD_LIMIT_MB}MB, 主动清理 seenMessageIds: ${before}→${after} (evictedTtl=${r.evictedTtl} evictedLru=${r.evictedLru})`);
    }
    return stats;
  });

  installLarkBotLifecycle();
}

// ═══════════════ 生命周期 ═══════════════

function installLarkBotLifecycle(): void {
  // 双 PID 看门狗：监控 DIRECT_PARENT（tsx CLI）和 AGENT_PID（PI Agent），任一退出即清理
  const DIRECT_PARENT = process.ppid;
  const AGENT_PID = process.env.LARK_PARENT_PID ? Number(process.env.LARK_PARENT_PID) : null;

  const monitoredPids: number[] = [DIRECT_PARENT];
  if (AGENT_PID && AGENT_PID > 0 && AGENT_PID !== DIRECT_PARENT) {
    monitoredPids.push(AGENT_PID);
  }

  log(`看门狗监控 PID=[${monitoredPids.join(", ")}]`);
  startWatchdog(monitoredPids, (deadPid) => {
    log(`进程 ${deadPid} 已退出，lark-bot 自动终止`);
    cleanup();
  });

  installSignalHandlers(cleanup);
  onExitCleanup(clearPidFile);
  installStdinShutdown(cleanup);
}

function cleanup(): void {
  killAllSessions();
  clearPidFile();
  process.exit(0);
}

main();
