/**
 * main.ts — lark-bot 进程入口（PR-1 适配版）
 *
 * 路径：agent-src/.pi/scripts/lark-bot/main.ts
 *
 * PR-1 变更（issue#168 N4 §3.2.1）：
 *   - 移除 process.ts 直接 import
 *   - 进程级防护（installCrashHandlers / checkRestartStorm / PID 文件 /
 *     startWatchdog / startHeartbeat / installSignalHandlers）已移交 systemd/pm2
 *   - installStdinShutdown / cleanupOldSessions 迁到
 *     extensions/lark-bot/process/{spawn-helper,session-cleanup}.ts
 *
 * 此文件保留作为 useExtensionMode=false 时的回滚入口。
 * 当 .pi/settings.json 设置 `larkBot.useExtensionMode: true` 时，
 * lark-bot 即当前 PI Agent extension 进程（extensions/lark-bot/index.ts），
 * main.ts 不再启动。
 *
 * 装配：读取 config → 启动日志 → 启动 p2p session → 启动飞书事件流
 */

import { cleanupOldSessions, startSessionCleanupInterval } from "../../extensions/lark-bot/process/session-cleanup.js";
import { AUTH_EVENT_KEYS, SESSION_EVICTION_INTERVAL_MS } from "./config.js";
import { log } from "./shared/logger.js";
import {
  enforceSessionLimit,
  evictIdleSessions,
  getAllSessions,
  setCloseBroadcastHandler,
  startAllPi,
} from "./interactive/session-manager.js";
import { authModule, broadcastModule, handleLarkEvent } from "./ingress.js";
import { startLarkEvents } from "./protocol/feishu.js";
import { pathToFileURL } from "node:url";

// 触发 ingress 模块的副作用（注册 60s 周期清理）
import "./ingress.js";

// ═══════════════ 启动 ═══════════════

export async function main(): Promise<void> {
  // PR-1：进程级 restart storm 检查已移交 systemd/pm2
  log("════════ lark-bot 启动（PR-1 回滚路径） ════════");
  log("⚠️ PR-1：进程级防护已移交 systemd/pm2");

  // commit 4：startAllPi 为空操作（per-p2p session 懒启动）
  startAllPi();
  // 注册 close_session 广播 handler（会话关闭时 broadcast 到对应群组，引用会话开启消息 + @用户）
  setCloseBroadcastHandler(async (_pi, ctx) => {
    await broadcastModule.announce({
      openId: ctx.openId,
      groupId: ctx.groupId,
      groupName: ctx.groupName,
      outcome: "ended",
      mentionOpenId: ctx.openId,
      replyToMessageId: ctx.replyToMessageId,
    });
  });
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

  // PR-1：session 文件清理迁到 extensions/lark-bot/process/session-cleanup.ts
  setTimeout(() => cleanupOldSessions(), 60 * 1000);
  startSessionCleanupInterval();

  // commit 4：周期性 session 淘汰（空闲超时 + 数量上限）
  setInterval(() => {
    const idle = evictIdleSessions();
    const lru = enforceSessionLimit();
    if (idle.evicted > 0 || lru.evicted > 0) {
      log(`🧹 [session 淘汰] idle=${idle.evicted} lru=${lru.evicted} 当前 sessions=${getAllSessions().length}`);
    }
  }, SESSION_EVICTION_INTERVAL_MS);

  // PR-1-cleanup：生命周期已全部移交 systemd/pm2
  // 不再安装 stdin shutdown / signal handlers / PID 文件 / 看门狗
}

// ═══════════════ 生命周期（PR-1-cleanup 已全部移交 systemd） ═══════════════
// PR-2：旧 cleanup() 函数已删除（未被调用）。session 清理在 idle 周期器中走 killAllSessions。

// ═══════════════ CLI 入口守卫：仅在直接调用本脚本时执行 main()
// vitest 等工具 import 本模块不会触发 main()（避免写 PID / 启动 session / 装 crash handler 等副作用）
// ═══════════════

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main();
}
