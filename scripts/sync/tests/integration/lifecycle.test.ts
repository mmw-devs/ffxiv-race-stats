/**
 * 集成测试: lifecycle
 *
 * 注入 fake 端口实现, 跑完整生命周期
 * 验证 8 步 + dry-run + 错误处理
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { syncOnePullRequest, syncOneIssue, syncAllPullRequests, type SyncDeps } from '../../src/lifecycle.js';
import type {
  PullRequest,
  Issue,
  FeishuRecord,
  FeishuRecordFields,
  SyncTarget,
} from '../../src/domain/types.js';
import type { GitHubSource } from '../../src/ports/github-source.js';
import type { FeishuTarget } from '../../src/ports/feishu-target.js';
import type { AuditLogger, AuditEntry } from '../../src/ports/audit-log.js';
import { NetworkError } from '../../src/errors.js';
import { prFixture, issueFixture, feishuRecordFixture } from '../helpers/fixtures.js';

// ============ Fake 实现 ============

class FakeAudit implements AuditLogger {
  entries: AuditEntry[] = [];

  async log(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async flush(): Promise<void> {}
}

class FakeGithub implements GitHubSource {
  prs: PullRequest[] = [];
  issues: Issue[] = [];

  constructor(prs: PullRequest[] = [], issues: Issue[] = []) {
    this.prs = prs;
    this.issues = issues;
  }

  async fetchPullRequest(n: number): Promise<PullRequest> {
    const pr = this.prs.find((p) => p.number === n);
    if (!pr) throw new NetworkError(`PR #${n} not found`);
    return pr;
  }

  async fetchIssue(n: number): Promise<Issue> {
    const issue = this.issues.find((i) => i.number === n);
    if (!issue) throw new NetworkError(`Issue #${n} not found`);
    return issue;
  }

  async *fetchAllPullRequests(): AsyncIterable<PullRequest> {
    for (const p of this.prs) yield p;
  }

  async *fetchAllIssues(): AsyncIterable<Issue> {
    for (const i of this.issues) yield i;
  }
}

class FakeFeishu implements FeishuTarget {
  records = new Map<string, FeishuRecord>();
  byGitHubId = new Map<string, string>();

  constructor(records: FeishuRecord[] = []) {
    for (const r of records) {
      this.records.set(r.recordId, { ...r, fields: { ...r.fields } });
      const ghId = r.fields['GitHub ID'];
      if (ghId) this.byGitHubId.set(ghId, r.recordId);
    }
  }

  async listFields() { return []; }
  async findByGitHubId(githubId: string): Promise<string | null> {
    return this.byGitHubId.get(githubId) ?? null;
  }
  async getRecord(target: SyncTarget, recordId: string): Promise<FeishuRecord | null> {
    const r = this.records.get(recordId);
    return r ? { ...r, fields: { ...r.fields } } : null;
  }
  async listRecords() {
    return [...this.records.values()].map((r) => ({ ...r, fields: { ...r.fields } }));
  }

  async createRecord(target: SyncTarget, fields: FeishuRecordFields): Promise<string> {
    const recordId = `rec${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.records.set(recordId, { recordId, fields: { ...fields } });
    const ghId = fields['GitHub ID'];
    if (ghId) this.byGitHubId.set(ghId, recordId);
    return recordId;
  }

  async updateRecord(target: SyncTarget, recordId: string, patch: Partial<FeishuRecordFields>): Promise<void> {
    const existing = this.records.get(recordId);
    if (!existing) throw new NetworkError(`record ${recordId} not found`);
    // 创建新对象 (不 mutate), 避免 lifecycle 拿 previousState 时拿到修改后的值
    this.records.set(recordId, {
      recordId,
      fields: { ...existing.fields, ...patch } as FeishuRecordFields,
    });
  }
}

// ============ Sync Target 简写 ============

const PR = 'pr' as const;

// ============ Tests ============

describe('lifecycle integration', () => {
  let audit: FakeAudit;
  let github: FakeGithub;
  let feishu: FakeFeishu;
  let deps: SyncDeps;

  beforeEach(() => {
    audit = new FakeAudit();
    github = new FakeGithub([prFixture('pr-merged.json')]);
    feishu = new FakeFeishu([]);
    deps = { github, feishu, audit, dryRun: false };
  });

  test('syncOnePullRequest: create (no existing)', async () => {
    const out = await syncOnePullRequest(70, deps);

    expect(out.action).toBe('create');
    expect(out.recordId).toBeDefined();
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.action).toBe('create');
    expect(audit.entries[0]?.githubId).toBe('PR_kwDOS6dS4s7zdOIC');
  });

  test('syncOnePullRequest: noop (already up-to-date)', async () => {
    const existing = feishuRecordFixture('feishu-record-merged.json');
    feishu.records.set(existing.recordId, existing);
    feishu.byGitHubId.set(existing.fields['GitHub ID'], existing.recordId);

    const out = await syncOnePullRequest(70, deps);

    expect(out.action).toBe('noop');
    expect(audit.entries[0]?.action).toBe('noop');
  });

  test('syncOnePullRequest: update (stale data)', async () => {
    const stale = feishuRecordFixture('feishu-record-stale.json');
    feishu.records.set(stale.recordId, stale);
    feishu.byGitHubId.set(stale.fields['GitHub ID'], stale.recordId);

    const out = await syncOnePullRequest(70, deps);

    expect(out.action).toBe('update');
    expect(out.recordId).toBe(stale.recordId);
    expect(audit.entries[0]?.action).toBe('update');
    expect(audit.entries[0]?.previousState).toBe('open');
    expect(audit.entries[0]?.currentState).toBe('merged');
  });

  test('syncOnePullRequest: dry-run 不写', async () => {
    deps.dryRun = true;

    const out = await syncOnePullRequest(70, deps);

    expect(out.action).toBe('create');
    expect(feishu.records.size).toBe(0);
    expect(out.reason).toContain('[dry-run]');
  });

  test('syncOneIssue: open issue', async () => {
    const issue = issueFixture('issue-open.json');
    github = new FakeGithub([prFixture('pr-merged.json')], [issue]);
    deps = { github, feishu, audit, dryRun: false };

    const out = await syncOneIssue(50, deps);

    expect(out.action).toBe('create');
    expect(audit.entries[0]?.action).toBe('create');
  });

  test('syncAllPullRequests: 多个 PR', async () => {
    github = new FakeGithub([
      prFixture('pr-merged.json'),
      prFixture('pr-open.json'),
    ]);
    deps = { github, feishu, audit, dryRun: false };

    const outcomes = await syncAllPullRequests(deps);

    expect(outcomes).toHaveLength(2);
    expect(feishu.records.size).toBe(2);
  });

  test('error: github fetch 失败 → audit conflict + 抛 exception', async () => {
    // deps.github 引用同一个 github 实例
    vi.spyOn(deps.github, 'fetchPullRequest').mockRejectedValue(new NetworkError('gh EOF'));

    await expect(syncOnePullRequest(70, deps)).rejects.toThrow('gh EOF');

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.action).toBe('conflict');
    expect(audit.entries[0]?.error).toContain('gh EOF');
  });
});
