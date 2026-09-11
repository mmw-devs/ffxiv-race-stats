/**
 * business/slots.ts — lark-bot 双域会话机制 slot 管理（issue#184）
 *
 * SSOT 视角：双域会话机制的 slot 配额计数器是 module-level 状态。
 * 独立模块以便测试 mock（extensions/lark-bot/index.ts 与 scripts/lark-bot/main.ts 共用）。
 *
 * 设计依据：docs/lark-bot-p2p-business-design.md §6（MAX_P2P_TEMP_SLOTS / MAX_P2P_BUSINESS_SLOTS）
 *
 * 调用约定：
 *   - tryReserveTempSlot() / tryReserveBusinessSlot() — 占用配额，配额满返回 false
 *   - releaseTempSlot() / releaseBusinessSlot() — 释放配额
 *   - countByKind() — 取当前域会话数（调试 / 心跳用）
 *   - resetSlots() — 测试 setup helper（vitest beforeEach 重置计数）
 */

import {
  MAX_P2P_TEMP_SLOTS,
  MAX_P2P_BUSINESS_SLOTS,
} from "../config.js";

// ── Module-level 状态 ──
let tempSlots = 0;
let businessSlots = 0;

/**
 * 占用一个临时私聊域槽位。配额已满返回 false（调用方应拒绝创建 session）。
 */
export function tryReserveTempSlot(): boolean {
  if (tempSlots >= MAX_P2P_TEMP_SLOTS) return false;
  tempSlots++;
  return true;
}

/**
 * 释放一个临时私聊域槽位（关闭 session / 升级到 business 域时调用）。
 * 防御性归零：避免计数下溢。
 */
export function releaseTempSlot(): void {
  if (tempSlots > 0) tempSlots--;
  if (tempSlots < 0) tempSlots = 0;
}

/**
 * 占用一个业务私聊域槽位。配额已满返回 false（larkbot_authorize_user matched 时调用）。
 */
export function tryReserveBusinessSlot(): boolean {
  if (businessSlots >= MAX_P2P_BUSINESS_SLOTS) return false;
  businessSlots++;
  return true;
}

/**
 * 释放一个业务私聊域槽位（关闭 business session / 降级时调用）。
 */
export function releaseBusinessSlot(): void {
  if (businessSlots > 0) businessSlots--;
  if (businessSlots < 0) businessSlots = 0;
}

/**
 * 取当前指定域的会话数（调试 / 心跳报告用）。
 */
export function countByKind(kind: "p2p-temp" | "p2p-business"): number {
  return kind === "p2p-temp" ? tempSlots : businessSlots;
}

/**
 * 测试 setup helper：重置 slot 计数器到初始状态（vitest beforeEach 调用）。
 * 生产环境不调用此函数。
 */
export function resetSlots(): void {
  tempSlots = 0;
  businessSlots = 0;
}
