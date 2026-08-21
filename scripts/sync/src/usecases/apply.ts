/**
 * Apply — 执行写
 *  - create: feishu.createRecord
 *  - update: feishu.updateRecord (patch)
 *  - noop:   不写, 返回已有 recordId
 *  - conflict: 抛 ConflictError
 */

import type { FeishuRecordFields, SyncPlan, SyncTarget } from '../domain/types.js';
import type { FeishuTarget } from '../ports/feishu-target.js';
import { ConflictError, NetworkError } from '../errors.js';

export async function apply(
  plan: SyncPlan,
  target: SyncTarget,
  source: FeishuRecordFields,
  feishu: FeishuTarget,
): Promise<string> {
  switch (plan.action) {
    case 'create': {
      return await feishu.createRecord(target, source);
    }
    case 'update': {
      if (!plan.recordId) {
        throw new ConflictError('update plan has no recordId', 'unknown');
      }
      await feishu.updateRecord(target, plan.recordId, plan.payload);
      return plan.recordId;
    }
    case 'noop': {
      if (!plan.recordId) {
        throw new ConflictError('noop plan has no recordId', 'unknown');
      }
      return plan.recordId;
    }
    case 'conflict': {
      throw new ConflictError(
        'cannot apply conflict plan',
        plan.recordId ?? 'unknown',
      );
    }
    default: {
      throw new NetworkError(`unknown plan action: ${String(plan.action)}`);
    }
  }
}
