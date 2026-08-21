/**
 * Build AuditEntry — 把同步过程的关键事件写成 AuditEntry
 *
 * 字段 redact (defense in depth): AuditStdout 也会做, 这里 pre-strip 一遍
 */

import type { AuditEntry } from '../ports/audit-log.js';
import type { SyncAction, SyncTarget, MergeStatus } from '../domain/types.js';

export function buildAuditEntry(args: {
  target: SyncTarget;
  number: number;
  githubId: string;
  action: SyncAction;
  reason: string;
  recordId?: string;
  previousState?: MergeStatus;
  currentState?: MergeStatus;
  error?: string;
  durationMs?: number;
}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    target: args.target,
    number: args.number,
    githubId: args.githubId,
    recordId: args.recordId,
    action: args.action,
    reason: args.reason,
    previousState: args.previousState,
    currentState: args.currentState,
    error: args.error,
    durationMs: args.durationMs,
  };
}
