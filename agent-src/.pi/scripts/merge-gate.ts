#!/usr/bin/env node

/**
 * 合并门禁 Extension — 骨架（路线图阶段 4 实现）
 *
 * 设计文档: docs/operations-system-design.md §5.4 "合并门禁"
 *
 * 职责：
 *   - 在执行 content/* → main 合并前，检查运营者是否已确认
 *   - 未确认 → 拒绝执行，返回可操作的原因
 *   - 已确认 → 放行，执行 merge
 *
 * 预期注册为 MCP 工具 "merge-content-branch"，
 * Agent 在收到运营者的合并确认后调用此工具。
 *
 * 伪代码逻辑:
 *
 *   function mergeContentBranch(sessionId: string): Result {
 *     const confirmed = sessionStore.get(sessionId)?.mergeConfirmed
 *     if (!confirmed) {
 *       return { allowed: false, reason: "Content PR 需要运营者在预览中确认后才能合并。请等待运营回复'合并'。" }
 *     }
 *     await git.merge()
 *     return { allowed: true, merged: true }
 *   }
 */

// 本文件为骨架，阶段 4 实现完整逻辑。
console.log("merge-gate: skeleton — 阶段 4 实现");
