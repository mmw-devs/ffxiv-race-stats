/**
 * extensions/lark-bot/process/children-registry.ts
 *
 * 依据：实测 6-3（PR-171 后补遗）
 *   "session_shutdown 不会自动清理 spawn 子进程——必须手动遍历 kill"
 *
 * 职责：
 *   1. 跟踪所有 spawn 出来的 ChildProcess（lark-cli / pi / 旧 lark-bot 进程）
 *   2. session_shutdown 时手动遍历 SIGTERM kill
 *   3. 单进程退出时从 Set 中自动清理（实测 5：原子操作）
 *
 * 约束（实测 5）：
 *   - add/remove 是原子操作（Set.add / Set.delete）
 *   - 不持有跨 await 的可变状态
 *
 * 用法：
 *   import { trackChild, killAllChildren, getChildrenCount } from "./children-registry.js";
 *
 *   // spawn 时
 *   const child = spawn(...);
 *   trackChild(child);
 *
 *   // session_shutdown 时
 *   pi.on("session_shutdown", async () => {
 *     const killed = killAllChildren();
 *   });
 */

import type { ChildProcess } from "node:child_process";

// ═══════════════ Module-level 单例（实测 5：原子 Set 操作） ═══════════════

/**
 * 全局 children Set。
 *
 * 设计：
 *   - 模块级单例：PR-1 范围内 lark-bot 仅一个进程，不需要 multi-instance
 *   - Set 而非 Array：add/delete/delete 都是 O(1) 原子操作
 *   - 不暴露 children 直接引用：调用方仅通过 add/kill/count 交互
 */
const children = new Set<ChildProcess>();

// ═══════════════ 公共 API ═══════════════

/**
 * 注册一个 spawn 出来的子进程。
 *
 * 行为：
 *   - 原子 Set.add
 *   - 注册 child.once("exit") 监听器：子进程退出时自动从 Set 中移除
 *
 * 注：使用 `once` 而非 `on`——子进程只触发一次 exit，多次触发是异常情况，
 * `once` 防止监听器泄漏。
 */
export function trackChild(child: ChildProcess): void {
  children.add(child);
  child.once("exit", () => {
    // 子进程退出时自动从 Set 中移除（单步原子操作）
    children.delete(child);
  });
}

/**
 * 从 Set 中手动移除一个子进程（不 kill）。
 *
 * 用例：
 *   - 调用方主动清理（如 larkbot_fetch_pending_events 处理完后）
 *   - 测试代码
 *
 * 一般情况下不需要调用本函数——exit 自动 remove。
 */
export function untrackChild(child: ChildProcess): void {
  children.delete(child);
}

/**
 * 遍历所有 tracked children 并发送 signal。
 *
 * 行为：
 *   - 已退出的进程（exitCode !== null 或 killed）跳过
 *   - 发送 signal（默认 SIGTERM）
 *   - 发送失败不抛错（best-effort）
 *   - 遍历后清空 Set
 *
 * 这是实测 6-3 强制要求——PI Agent session_shutdown 不会自动清理 spawn 子进程。
 *
 * @param signal 发送给子进程的信号，默认 SIGTERM
 * @returns 实际发送信号的子进程数量
 */
export function killAllChildren(signal: NodeJS.Signals = "SIGTERM"): number {
  let killed = 0;
  for (const child of children) {
    if (child.exitCode !== null || child.killed) continue;
    try {
      child.kill(signal);
      killed++;
    } catch {
      // best-effort：kill 失败不抛错（可能进程已死 / 权限不足）
    }
  }
  children.clear();
  return killed;
}

/** 当前活跃 children 数量（心跳 / 调试用） */
export function getChildrenCount(): number {
  return children.size;
}

/** 取所有 tracked children（仅快照，用于调试 / 日志；不应修改） */
export function getChildrenSnapshot(): ChildProcess[] {
  return Array.from(children);
}

// ═══════════════ 测试辅助（生产代码禁止调用） ═══════════════

/**
 * 仅用于测试：清空 children Set。
 *
 * 生产代码不应调用——可能导致 spawn 子进程脱离管理。
 */
export function __resetChildrenForTesting(): void {
  children.clear();
}
