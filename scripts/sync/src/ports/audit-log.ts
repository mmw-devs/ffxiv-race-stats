/**
 * Audit Log — 端口定义
 *
 * 记录每次同步动作 (成功 / 失败 / 跳过)
 * 适配器 (阶段 2) 可以是 stdout / file / 飞书云空间 / 任何
 *
 * 关键约束:
 *  - redacted 字段: 凭据 (token / secret) 不能出现在 entry
 *  - entry 字段必须是 redact-safe (域模型保证)
 */

import type { SyncAction, SyncTarget, MergeStatus } from '../domain/types.js';

export interface AuditEntry {
  /** ISO-8601 时间戳 */
  timestamp: string;
  /** 同步对象 */
  target: SyncTarget;
  /** GitHub PR/Issue number */
  number: number;
  /** GitHub node_id (用来跨系统对照) */
  githubId: string;
  /** 实际动作 */
  action: SyncAction;
  /** 决策原因 (e.g. "created (no existing record)") */
  reason: string;
  /** 飞书侧 recordId (create/update 后填) */
  recordId?: string;
  /** 同步前状态 (在 audit 里完整呈现) */
  previousState?: MergeStatus;
  /** 同步后状态 */
  currentState?: MergeStatus;
  /** 错误信息 (失败时填, 已 redact) */
  error?: string;
  /** 持续时长 (ms) */
  durationMs?: number;
}

export interface AuditLogger {
  /** 写一条 entry (同步 flush, 实现决定 batch 还是流式) */
  log(entry: AuditEntry): Promise<void>;
  /** 显式 flush (e.g. 切换 trigger 边界) */
  flush(): Promise<void>;
}
