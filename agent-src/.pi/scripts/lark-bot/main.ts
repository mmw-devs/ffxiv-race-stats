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
  installStdinControl,
  onExitCleanup,
  startHeartbeat,
  startWatchdog,
  writePidFile,
} from "./process.js";
import { AUTH_EVENT_KEYS, HEAP_HARD_LIMIT_MB, SESSION_EVICTION_INTERVAL_MS } from "./config.js";
import { emitTaskJournal, log } from "./shared/logger.js";
import {
  cleanupSeenMessageIds,
  closeSession,
  enforceSessionLimit,
  evictIdleSessions,
  getAllSessions,
  getPiRestartStats,
  startAllPi,
  killAllSessions,
} from "./interactive/session-manager.js";
import { authModule, handleLarkEvent } from "./ingress.js";
import { startLarkEvents } from "./protocol/feishu.js";
import { pathToFileURL } from "node:url";

// 触发 ingress 模块的副作用（注册 60s 周期清理）
import "./ingress.js";

// ═══════════════ 启动 ═══════════════

export async function main(): Promise<void> {
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
  // 群组鉴权冷启动（启动期一次性 API 调用，失败 → fail-fast）
  // authModule 单例来自 ingress.ts，构造期不调 API
  await authModule.initBoot();

  // 事件驱动鉴权缓存（零轮询）
  // 启动 8 个 EventKey 订阅（按 AUTH_EVENT_KEYS）：
  //   - im.message.receive_v1            → handleLarkEvent（私聊消息处理）
  //   - im.chat.member.bot.added_v1      → authModule.onChatAdded（补 description + members）
  //   - im.chat.member.bot.deleted_v1    → authModule.onChatDeleted（删内存）
  //   - im.chat.member.user.added_v1     → authModule.onUserAdded
  //   - im.chat.member.user.deleted_v1   → authModule.onUserDeleted
  //   - im.chat.member.user.withdrawn_v1 → noop（不影响已通过成员）
  //   - im.chat.updated_v1               → authModule.onChatUpdated（payload 含 description）
  //   - im.chat.disbanded_v1             → authModule.onChatDisbanded
  for (const eventKey of AUTH_EVENT_KEYS) {
    switch (eventKey) {
      case "im.message.receive_v1":
        startLarkEvents(eventKey, (event) => { void handleLarkEvent(event as any); });
        break;
      case "im.chat.member.bot.added_v1":
        startLarkEvents(eventKey, (event) => {
          const payload = (event as any)?.event ?? event;
          void authModule.onChatAdded(payload);
        });
        break;
      case "im.chat.member.bot.deleted_v1":
        startLarkEvents(eventKey, (event) => {
          const payload = (event as any)?.event ?? event;
          const chatId = payload?.chat_id;
          if (typeof chatId === "string") authModule.onChatDeleted(chatId);
        });
        break;
      case "im.chat.member.user.added_v1":
        startLarkEvents(eventKey, (event) => {
          const payload = (event as any)?.event ?? event;
          authModule.onUserAdded(payload);
        });
        break;
      case "im.chat.member.user.deleted_v1":
        startLarkEvents(eventKey, (event) => {
          const payload = (event as any)?.event ?? event;
          authModule.onUserDeleted(payload);
        });
        break;
      case "im.chat.member.user.withdrawn_v1":
        // 邀请撤回不影响已通过成员，noop
        startLarkEvents(eventKey, () => {});
        break;
      case "im.chat.updated_v1":
        startLarkEvents(eventKey, (event) => {
          const payload = (event as any)?.event ?? event;
          authModule.onChatUpdated(payload);
        });
        break;
      case "im.chat.disbanded_v1":
        startLarkEvents(eventKey, (event) => {
          const payload = (event as any)?.event ?? event;
          const chatId = payload?.chat_id;
          if (typeof chatId === "string") authModule.onChatDisbanded(chatId);
        });
        break;
      default:
        log(`⚠️ [main] 未处理 EventKey: ${eventKey}`);
    }
  }

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
  installStdinControl({
    shutdown: cleanup,
    closeSession: (reason) => {
      // PI Agent 请求关闭当前 session 对应的 lark-bot 会话
      // 遍历所有 session（per-p2p 架构下一般只有 1 个，但兜底遍历）
      for (const pi of getAllSessions()) {
        if (pi.authorized) {
          closeSession(pi.key, `agent_close_session: ${reason ?? "unspecified"}`);
          emitTaskJournal({
            eventTime: new Date().toISOString(),
            promptId: "n/a",
            operator: "unknown",
            operatorName: null,
            state: "terminated",
            reason: `agent_close_session: ${reason ?? "unspecified"}`,
          });
          log(`🔒 [${pi.key.slice(-12)}] PI Agent stdin close_session: ${reason ?? "unspecified"}`);
        } else {
          closeSession(pi.key, `agent_close_session_unauthed: ${reason ?? "unspecified"}`);
        }
      }
    },
  });
}

function cleanup(): void {
  killAllSessions();
  clearPidFile();
  process.exit(0);
}

// ═══════════════ CLI 入口守卫：仅在直接调用本脚本时执行 main()
// vitest 等工具 import 本模块不会触发 main()（避免写 PID / 启动 session / 装 crash handler 等副作用）
// ═══════════════

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main();
}
