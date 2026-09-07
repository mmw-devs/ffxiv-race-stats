/**
 * protocol/feishu.ts — L1 Protocol 层（飞书适配器）
 *
 * SSOT 视角：所有与 lark-cli 的对话经由此模块；本模块不持有任何
 * 业务状态（dedup / 任务队列归 ingress 与 session-manager）。
 *
 * 「群聊=广播」重构后移除的功能：
 *   - pollActiveThreads / polledMsgIds / knownChatIds（不再轮询群聊）
 *   - sendReply / sendReplyGetId 的 replyInThread 参数（p2p 无 thread）
 *   - isMentioned（p2p 不存在 @mention 概念）
 *
 * 本文件保留：
 *   - 飞书事件原始类型（LarkEvent，已精简）
 *   - 表情协议（addReaction / delReaction / switchReaction）
 *   - 消息回复（sendReply / sendReplyGetId，无 replyInThread）
 *   - WS 事件流（startLarkEvents）
 *   - stripMention（p2p 内容可能含字面 @bot 文本）
 */

import { spawn, ChildProcess, execSync } from "node:child_process";
import {
  BOT_NAME,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  CLI,
  EMOJI_READ,
  REPLY_SEND_TIMEOUT_MS,
} from "../config.js";
import type { LarkEvent, PendingTask, SendReplyResult } from "../shared/types.js";
import { log } from "../shared/logger.js";

// ═══════════════ 飞书 API 熔断器（R2 L1 Protocol） ═══════════════

/**
 * 飞书 API 连续失败熔断器。
 *
 * 目的：避免飞书服务异常（配额耗尽 / 网络抖动 / 后端 5xx）造成调用雪崩。
 * 行为：
 *   - 连续 CIRCUIT_BREAKER_THRESHOLD 次失败 → 熔断 CIRCUIT_BREAKER_COOLDOWN_MS
 *   - 熔断期间所有调用快速返回 null（表情）或 false（回复）
 *   - 冷却期过后尝试一次成功调用 → 重置计数
 *
 * 设计取舍：熔断器状态为模块级单例，因为：
 *   - lark-bot 是单进程单租户，无需多 tenant 隔离
 *   - 与 protocol/feishu.ts 的「无业务状态」原则冲突 —— 但熔断器属于「依赖健康度」，
 *     不是业务状态，且只能放在调用方所在的同一层
 */
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    log(`⚠️ [circuit breaker] 连续 ${consecutiveFailures} 次失败，熔断 ${CIRCUIT_BREAKER_COOLDOWN_MS}ms`);
  }
}

function recordSuccess(): void {
  if (consecutiveFailures > 0) {
    log(`✅ [circuit breaker] 调用恢复，重置失败计数（之前 ${consecutiveFailures}）`);
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
  }
}

/** 暴露给运维侧/测试，读取当前熔断状态 */
export function getCircuitBreakerState(): { open: boolean; failures: number; openUntil: number } {
  return {
    open: Date.now() < circuitOpenUntil,
    failures: consecutiveFailures,
    openUntil: circuitOpenUntil,
  };
}

// ═══════════════ 表情协议 ═══════════════

export function addReaction(msgId: string, emoji: string): string | null {
  // 熔断期间快速失败，不浪费 lark-cli spawn
  if (Date.now() < circuitOpenUntil) return null;
  try {
    const params = JSON.stringify({ message_id: msgId });
    const data = JSON.stringify({ reaction_type: { emoji_type: emoji } });
    const out = execSync(
      `"${CLI}" im reactions create --as bot --params '${params}' --data '${data}'`,
      { timeout: 5000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    recordSuccess();
    return JSON.parse(out).data?.reaction_id ?? null;
  } catch {
    recordFailure();
    return null;
  }
}

function delReaction(msgId: string, reactionId: string): void {
  if (!reactionId) return;
  // delReaction 是 best-effort，熔断期直接跳过
  if (Date.now() < circuitOpenUntil) return;
  const params = JSON.stringify({ message_id: msgId, reaction_id: reactionId });
  try {
    execSync(`"${CLI}" im reactions delete --as bot --params '${params}'`, { timeout: 5000, encoding: "utf-8", stdio: "ignore" });
    recordSuccess();
  } catch {
    recordFailure();
  }
}

/**
 * 统一切换任务的表情：
 *   1. 先 addReaction 拿新 reactionId（保证切换顺序：旧→新）
 *   2. 成功后才 delReaction 旧的，避免新表情未生效前先移除旧表情
 *   3. 失败只记日志，不阻断业务流程（表情失败仅影响视觉）
 *
 * 调用方需把返回的 reactionId 写回 task.reactionId，便于下次切换。
 */
export function switchReaction(task: Pick<PendingTask, "msgId" | "reactionId">, emoji: string): string | null {
  const newId = addReaction(task.msgId, emoji);
  if (!newId) {
    log(`表情切换失败: msgId=${task.msgId.slice(-8)} emoji=${emoji}`);
    return task.reactionId;
  }
  delReaction(task.msgId, task.reactionId ?? "");
  task.reactionId = newId;
  return newId;
}

// ═══════════════ 飞书回复 ═══════════════

export function sendReply(msgId: string, text: string): void {
  // sendReply 是 fire-and-forget，不走熔断器（无返回值无法判断成功失败）
  // 调用方如需确认应使用 sendReplyGetId
  const args = ["im", "+messages-reply", "--as", "bot", "--message-id", msgId, "--text", text];
  spawn(CLI, args, { stdio: "ignore" }).on("error", (e) => log(`reply fire-and-forget 失败: msgId=${msgId.slice(-8)} err=${e.message}`));
}

/**
 * 飞书回复并获取新消息 ID。
 *   - 内置超时（REPLY_SEND_TIMEOUT_MS）：超时后 kill 子进程，结果不明确走 ERROR
 *   - 响应解析失败：走 ERROR（不猜测）
 *   - 拿不到 replyId：走 ERROR（不重发）
 *   - 一律不重试：调用方根据 ok 决定 DONE/ERROR
 *   - 熔断期快速返回 ok=false（不浪费 spawn）
 */
export function sendReplyGetId(msgId: string, text: string): Promise<SendReplyResult> {
  return new Promise((resolve) => {
    // 熔断期快速失败：节省 lark-cli spawn 开销，避免加重后端压力
    if (Date.now() < circuitOpenUntil) {
      resolve({ ok: false, replyId: null, error: "circuit breaker open" });
      return;
    }
    const args = ["im", "+messages-reply", "--as", "bot", "--message-id", msgId, "--text", text, "--format", "json"];
    let out = "";
    let settled = false;

    const finish = (r: SendReplyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      // 超时：拿不到结果不猜测，kill 子进程防泄漏
      try { p.kill("SIGKILL"); } catch {}
      recordFailure();
      finish({ ok: false, replyId: null, error: `timeout after ${REPLY_SEND_TIMEOUT_MS}ms`, timedOut: true });
    }, REPLY_SEND_TIMEOUT_MS);

    const p = spawn(CLI, args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout?.on("data", (d: Buffer) => { out += d.toString("utf-8"); });
    p.on("close", (code) => {
      if (settled) return; // 已超时结算
      let parsed: any = null;
      try { parsed = JSON.parse(out); } catch {}
      const replyId = parsed?.data?.message_id;
      if (replyId && typeof replyId === "string") {
        recordSuccess();
        finish({ ok: true, replyId });
      } else {
        const err = parsed?.msg || parsed?.error || `exit code=${code}, no message_id, stdout=${out.slice(0, 200)}`;
        recordFailure();
        finish({ ok: false, replyId: null, error: String(err) });
      }
    });
    p.on("error", (e) => {
      recordFailure();
      finish({ ok: false, replyId: null, error: `spawn error: ${e.message}` });
    });
  });
}

// ═══════════════ 内容清洗 ═══════════════

/**
 * 去除消息开头的 @提及（p2p 内用户也可能字面输入 @Bot 名称）。
 * 注意：原代码中正则存在一处 `\S` 写成了字面 `\\S`（疑似 bug），保留以保持行为零变化。
 */
export function stripMention(content: string): string {
  const cleaned = content.replace(new RegExp(`^@${BOT_NAME}\\s+`, "i"), "").replace(/^@\\S+\s+/, "").trim();
  return cleaned || content.trim();
}

// ═══════════════ WS 事件流 ═══════════════

/**
 * 启动 lark-cli event consume 并把 NDJSON 解析后的事件交给 onEvent 回调。
 * 返回的 ChildProcess 由调用方持有以做生命周期管理。
 *
 * 设计：当前架构下只关心 im.message.receive_v1；群聊事件由 onEvent 回调方丢弃。
 */
export function startLarkEvents(onEvent: (event: LarkEvent) => void): ChildProcess {
  log("启动 lark-cli event consume ...");
  const child = spawn(CLI, ["event", "consume", "im.message.receive_v1", "--as", "bot"], { stdio: ["pipe", "pipe", "pipe"] });

  let buf = "";
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString("utf-8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let parsed: LarkEvent | null = null;
      try { parsed = JSON.parse(line); } catch {}
      if (!parsed) {
        // JSON 解析失败：记日志后跳过该行，绝不传播异常到 stream 监听器
        // （否则 stream 监听器抛错会导致 lark-bot 进程崩溃）
        log(`⚠️ [startLarkEvents] NDJSON 解析失败: ${line.slice(0, 100)}`);
        continue;
      }
      // onEvent 是 ingress.handleLarkEvent，其内部已 try/catch（R3 L2）
      // commit 4 后 handleLarkEvent 是 async（需要 await ensureSession 懒启动）
      // 此处既兜底同步抛异常，也捕获 Promise 拒绝
      try {
        const ret = onEvent(parsed);
        if (ret && typeof (ret as any).then === "function") {
          (ret as Promise<void>).catch((e: any) => {
            log(`💥 [startLarkEvents] onEvent async 异常: ${e?.message?.slice(0, 200)}`);
          });
        }
      } catch (e: any) {
        // 兜底：onEvent 抛异常时记日志但不传播
        log(`💥 [startLarkEvents] onEvent 抛异常: ${e?.message?.slice(0, 200)}`);
      }
    }
  });

  child.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString("utf-8").trim();
    if (msg.includes("[event] ready")) log("✅ 飞书 WebSocket 已就绪");
    else if (msg.includes("[event] exited")) log(`飞书事件流结束: ${msg}`);
    else if (msg.includes('"ok":false')) log(`飞书错误: ${msg.slice(0, 200)}`);
  });

  child.on("exit", (code) => { log(`飞书事件流退出 code=${code}`); setTimeout(() => startLarkEvents(onEvent), 5000); });
  return child;
}
