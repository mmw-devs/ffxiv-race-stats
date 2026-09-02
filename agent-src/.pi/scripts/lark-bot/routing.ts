/**
 * routing.ts — L3 Routing 层（显式路由表）
 *
 * SSOT 视角：
 *   - 所有「inbound event → 子系统 / session」的路由决策集中在此
 *
 * 当前路由表（commit 4 后）：
 *   chat_type === "p2p"   → "p2p:<chat_id>"      (interactive, 每 chat 一个 session)
 *   chat_type === "group" → 已被 ingress.shouldHandle 丢弃,理论上不进 routing
 *
 * 演进计划：当 broadcast 子系统实现后,本表新增：
 *   - outbound: Agent → chat_type="group" 的推送路径
 *   - inbound: chat_type="group" 但 sender=bot 的入站事件（自发自收丢弃）
 *
 * commit 4 设计要点：
 *   - sessionKey 含 chat_id 保证每私聊独立 session
 *   - 同一 chat_id 重复进入 routing 命中同一 session（dedup by key）
 *   - 不同 chat_id 各自独立 activeTask / waitingTasks / Agent 上下文
 *
 * 当前 broadcast/ 目录仅占位,本文件不引用。
 */

import type { LarkEvent } from "./shared/types.js";

export function sessionKey(event: LarkEvent): string {
  if (event.chat_type === "p2p") return `p2p:${event.chat_id}`;
  // 防御性：当前架构下 group 事件已被 ingress 丢弃,不应走到此处
  // 若未来 broadcast 入站出现,此处需扩展
  return `group:${event.chat_id}`;
}
