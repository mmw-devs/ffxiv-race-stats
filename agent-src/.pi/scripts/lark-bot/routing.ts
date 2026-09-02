/**
 * routing.ts — L3 Routing 层（显式路由表）
 *
 * SSOT 视角：
 *   - 所有「inbound event → 子系统 / session」的路由决策集中在此
 *   - 当前实现：纯函数 sessionKey()，按 chat_type 决定 sessionKey
 *   - 未来扩展：可升级为查找表（chat_id → subsystem 映射），
 *     例如把群聊路由到 broadcast 子系统、私聊路由到 interactive 子系统
 *
 * 当前路由表（单条规则）：
 *   chat_type === "p2p"      → sessionKey = "p2p"           (interactive)
 *   chat_type === "group"    → sessionKey = `group:<id>`    (interactive，群聊仍走 p2p 业务)
 *
 * 演进计划：当 broadcast 子系统实现后，本表增加：
 *   chat_type === "group" 发件人 == BOT      → 丢弃（自发自收）
 *   chat_type === "group" 且 chatId ∈ subscribers  → broadcast
 */

import type { LarkEvent } from "./shared/types.js";

export function sessionKey(event: LarkEvent): string {
  if (event.chat_type === "p2p") return "p2p";
  return `group:${event.chat_id}`;
}
