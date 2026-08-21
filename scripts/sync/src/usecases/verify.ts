/**
 * Verify — 写完后回查, 验证关键字段一致
 *
 * 验证: 编号 / 状态 / URL / GitHub ID
 * (其他字段在校验时可能有 race condition, 关键字段够)
 */

import type { FeishuRecordFields, SyncTarget } from '../domain/types.js';
import type { FeishuTarget } from '../ports/feishu-target.js';
import { NetworkError } from '../errors.js';

const VERIFY_FIELDS = ['编号', '状态', 'URL', 'GitHub ID'] as const;

export async function verify(
  target: SyncTarget,
  recordId: string,
  expected: FeishuRecordFields,
  feishu: FeishuTarget,
): Promise<void> {
  const actual = await feishu.getRecord(target, recordId);
  if (!actual) {
    throw new NetworkError(`verify failed: record ${recordId} not found`);
  }
  for (const key of VERIFY_FIELDS) {
    const expectedVal = expected[key];
    const actualVal = actual.fields[key];
    if (!shallowEqual(expectedVal, actualVal)) {
      throw new NetworkError(
        `verify failed: field "${key}" expected ${JSON.stringify(expectedVal)} but got ${JSON.stringify(actualVal)}`,
      );
    }
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return false;
}
