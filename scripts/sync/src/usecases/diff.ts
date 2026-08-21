/**
 * Diff — 计算字段差异
 *
 * 纯函数: 输入 source + target, 输出 patch (只包含变化的字段)
 *
 * 深比较: 数组 / 对象要按内容比较, 不能 == 比较
 */

import type { FeishuRecordFields } from '../domain/types.js';

export interface FieldDiff {
  field: keyof FeishuRecordFields;
  before: unknown;
  after: unknown;
  changed: boolean;
}

export function diffFields(
  source: FeishuRecordFields,
  target: FeishuRecordFields | null,
): FieldDiff[] {
  const fields = Object.keys(source) as (keyof FeishuRecordFields)[];
  const diffs: FieldDiff[] = [];
  for (const field of fields) {
    const before = target ? target[field] : undefined;
    const after = source[field];
    const changed = !deepEqual(before, after);
    diffs.push({ field, before, after, changed });
  }
  return diffs;
}

export function diffPatch(
  source: FeishuRecordFields,
  target: FeishuRecordFields | null,
): Partial<FeishuRecordFields> {
  const diffs = diffFields(source, target);
  const patch: Partial<FeishuRecordFields> = {};
  for (const d of diffs) {
    if (d.changed) {
      (patch as Record<string, unknown>)[d.field] = d.after;
    }
  }
  return patch;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ));
  }
  return false;
}
