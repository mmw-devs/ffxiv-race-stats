/**
 * Plan — 决策
 *  - existing == null         → create
 *  - existing != null 且一致 → noop
 *  - existing != null 且差异 → update
 *  - 探测字段冲突            → conflict (留给业务定义)
 */

import type { FeishuRecord, FeishuRecordFields, SyncAction, SyncPlan } from '../domain/types.js';
import { diffPatch } from './diff.js';

export function buildPlan(
  source: FeishuRecordFields,
  existing: FeishuRecord | null,
): SyncPlan {
  if (!existing) {
    return {
      action: 'create',
      payload: source,
      reason: 'no existing record',
    };
  }
  const patch = diffPatch(source, existing.fields);
  const changedFields = Object.keys(patch);
  if (changedFields.length === 0) {
    return {
      action: 'noop',
      recordId: existing.recordId,
      payload: {},
      reason: 'all fields match',
    };
  }
  return {
    action: 'update',
    recordId: existing.recordId,
    payload: patch,
    reason: `${changedFields.length} fields changed: ${changedFields.join(', ')}`,
  };
}

export function isWriteAction(action: SyncAction): boolean {
  return action === 'create' || action === 'update';
}
