/**
 * 单元测试: plan (决策)
 */

import { describe, test, expect } from 'vitest';
import { buildPlan, isWriteAction } from '../../src/usecases/plan.js';
import { prToFeishuFields } from '../../src/field-mapping.js';
import { prFixture, feishuRecordFixture } from '../helpers/fixtures.js';

describe('plan', () => {
  test('no existing → create', () => {
    const pr = prFixture('pr-merged.json');
    const source = prToFeishuFields(pr);
    const plan = buildPlan(source, null);
    expect(plan.action).toBe('create');
    expect(plan.payload).toEqual(source);
    expect(plan.reason).toContain('no existing');
  });

  test('all fields match → noop', () => {
    const pr = prFixture('pr-merged.json');
    const source = prToFeishuFields(pr);
    const existing = feishuRecordFixture('feishu-record-merged.json');
    const plan = buildPlan(source, existing);
    expect(plan.action).toBe('noop');
    expect(plan.recordId).toBe(existing.recordId);
    expect(Object.keys(plan.payload)).toHaveLength(0);
  });

  test('部分字段不同 → update with patch', () => {
    const pr = prFixture('pr-merged.json');
    const source = prToFeishuFields(pr);
    const stale = feishuRecordFixture('feishu-record-stale.json');
    const plan = buildPlan(source, stale);
    expect(plan.action).toBe('update');
    expect(plan.recordId).toBe(stale.recordId);
    expect(plan.payload).toHaveProperty('状态');
    expect(plan.reason).toContain('changed');
  });

  test('isWriteAction: create / update true', () => {
    expect(isWriteAction('create')).toBe(true);
    expect(isWriteAction('update')).toBe(true);
  });

  test('isWriteAction: noop / conflict false', () => {
    expect(isWriteAction('noop')).toBe(false);
    expect(isWriteAction('conflict')).toBe(false);
  });
});
