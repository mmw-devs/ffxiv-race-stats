/**
 * 单元测试: field-mapping
 */

import { describe, test, expect } from 'vitest';
import { prToFeishuFields, issueToFeishuFields } from '../../src/field-mapping.js';
import { prFixture, issueFixture } from '../helpers/fixtures.js';

describe('field-mapping', () => {
  describe('prToFeishuFields', () => {
    test('merged PR → 状态 = merged', () => {
      const pr = prFixture('pr-merged.json');
      const fields = prToFeishuFields(pr);
      expect(fields['状态']).toBe('merged');
      expect(fields['编号']).toBe(70);
      expect(fields['标题']).toBe('feat: GitHub Issue/PR 同步到飞书多维表格');
    });

    test('open PR → 状态 = open', () => {
      const pr = prFixture('pr-open.json');
      const fields = prToFeishuFields(pr);
      expect(fields['状态']).toBe('open');
      expect(fields['编号']).toBe(103);
    });

    test('assignees 多个时用 ", " join', () => {
      const pr = prFixture('pr-merged.json');
      const fields = prToFeishuFields(pr);
      expect(fields['负责人']).toBe('ops-bot');
    });

    test('assignees 空时 负责人 = null', () => {
      const pr = prFixture('pr-open.json');
      const fields = prToFeishuFields(pr);
      expect(fields['负责人']).toBeNull();
    });

    test('labels 多个时映射成数组', () => {
      const pr = prFixture('pr-merged.json');
      const fields = prToFeishuFields(pr);
      expect(fields['标签']).toEqual(['feature', 'P0']);
    });

    test('labels 空时 标签 = null', () => {
      const pr = prFixture('pr-open.json');
      const fields = prToFeishuFields(pr);
      expect(fields['标签']).toEqual(['dependencies']);
    });

    test('源分支 / 目标分支 保留', () => {
      const pr = prFixture('pr-merged.json');
      const fields = prToFeishuFields(pr);
      expect(fields['源分支']).toBe('feature/github-feishu-sync');
      expect(fields['目标分支']).toBe('main');
    });

    test('GitHub ID 保留', () => {
      const pr = prFixture('pr-merged.json');
      const fields = prToFeishuFields(pr);
      expect(fields['GitHub ID']).toBe('PR_kwDOS6dS4s7zdOIC');
    });

    test('PR 状态字段: closed 但 mergedAt null → 状态 = closed', () => {
      const pr = prFixture('pr-merged.json');
      const fields = prToFeishuFields({ ...pr, mergedAt: null });
      expect(fields['状态']).toBe('closed');
    });
  });

  describe('issueToFeishuFields', () => {
    test('open issue → 状态 = open', () => {
      const issue = issueFixture('issue-open.json');
      const fields = issueToFeishuFields(issue);
      expect(fields['状态']).toBe('open');
    });

    test('closed issue → 状态 = closed', () => {
      const issue = issueFixture('issue-closed.json');
      const fields = issueToFeishuFields(issue);
      expect(fields['状态']).toBe('closed');
    });

    test('issue 没有 源分支 / 目标分支 → null', () => {
      const issue = issueFixture('issue-open.json');
      const fields = issueToFeishuFields(issue);
      expect(fields['源分支']).toBeNull();
      expect(fields['目标分支']).toBeNull();
    });

    test('issue 没有 GitHub ID 前缀检查', () => {
      const issue = issueFixture('issue-closed.json');
      const fields = issueToFeishuFields(issue);
      expect(fields['GitHub ID']).toBe('I_kwDOS6dS4s8c3d4e');
      expect(fields['编号']).toBe(100);
    });
  });
});
