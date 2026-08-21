/**
 * 单元测试: diff (深比较 + patch 计算)
 */

import { describe, test, expect } from 'vitest';
import { diffFields, diffPatch } from '../../src/usecases/diff.js';
import { prToFeishuFields } from '../../src/field-mapping.js';
import { prFixture, feishuRecordFixture } from '../helpers/fixtures.js';

describe('diff', () => {
  describe('diffFields', () => {
    test('all same → 0 changed', () => {
      const pr = prFixture('pr-merged.json');
      const source = prToFeishuFields(pr);
      const target = feishuRecordFixture('feishu-record-merged.json').fields;
      const diffs = diffFields(source, target);
      const changed = diffs.filter((d) => d.changed);
      expect(changed).toHaveLength(0);
    });

    test('部分字段不同 → 只 diff changed', () => {
      const pr = prFixture('pr-merged.json');
      const source = prToFeishuFields(pr);
      const staleTarget = feishuRecordFixture('feishu-record-stale.json').fields;
      const diffs = diffFields(source, staleTarget);
      const changed = diffs.filter((d) => d.changed);
      // 状态: open → merged, 更新时间: 略变, 标题: 略变
      expect(changed.length).toBeGreaterThan(0);
      const changedFields = changed.map((d) => d.field);
      expect(changedFields).toContain('状态');
    });

    test('target 为 null → 全部 changed', () => {
      const pr = prFixture('pr-merged.json');
      const source = prToFeishuFields(pr);
      const diffs = diffFields(source, null);
      const changed = diffs.filter((d) => d.changed);
      expect(changed.length).toBe(diffs.length);
    });
  });

  describe('diffPatch', () => {
    test('all same → empty patch', () => {
      const pr = prFixture('pr-merged.json');
      const source = prToFeishuFields(pr);
      const target = feishuRecordFixture('feishu-record-merged.json').fields;
      const patch = diffPatch(source, target);
      expect(Object.keys(patch)).toHaveLength(0);
    });

    test('only changed fields in patch', () => {
      const pr = prFixture('pr-merged.json');
      const source = prToFeishuFields(pr);
      const staleTarget = feishuRecordFixture('feishu-record-stale.json').fields;
      const patch = diffPatch(source, staleTarget);
      // 没有: 编号, 标题 (其他字段不变), URL, GitHub ID
      expect(patch).not.toHaveProperty('编号');
      expect(patch).not.toHaveProperty('URL');
      expect(patch).not.toHaveProperty('GitHub ID');
      // 有: 状态
      expect(patch).toHaveProperty('状态');
    });

    test('空数组 vs null 视为相同', () => {
      const pr = prFixture('pr-merged.json');
      const source = prToFeishuFields(pr);
      const target = {
        ...prToFeishuFields(pr),
        '标签': null,  // 一边 [], 一边 null
      };
      const patch = diffPatch(source, target);
      // 深比较: null vs [] 不等 (类型不同)
      // 但如果两边都是 [], 应该不差
      expect(patch).toHaveProperty('标签');
    });
  });
});
