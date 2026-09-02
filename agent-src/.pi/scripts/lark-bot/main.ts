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
  checkExistingPid,
  clearPidFile,
  cleanupOldSessions,
  installSignalHandlers,
  installStdinShutdown,
  onExitCleanup,
  startWatchdog,
  writePidFile,
} from "./process.js";
import { log } from "./shared/logger.js";
import { startAllPi, killAllSessions } from "./interactive/session-manager.js";
import { handleLarkEvent } from "./ingress.js";
import { startLarkEvents } from "./protocol/feishu.js";

// 触发 ingress 模块的副作用（注册 60s 周期清理）
import "./ingress.js";

// ═══════════════ 启动 ═══════════════

function main(): void {
  // 启动期 PID 校验：使用 isAlive() 确保 Windows 下也能准确检测
  if (checkExistingPid()) {
    log("已在运行（PID 文件存在且进程存活）");
    process.exit(0);
  }
  writePidFile(process.pid);
  log("════════ lark-bot 启动 ════════");

  // 仅启动 p2p session
  startAllPi();
  // WS 事件流：群聊事件由 ingress 丢弃
  startLarkEvents((event) => handleLarkEvent(event));

  // session 文件清理（保留，每 24h 一次）
  setTimeout(() => cleanupOldSessions(), 60 * 1000);
  setInterval(cleanupOldSessions, 24 * 60 * 60 * 1000);

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
