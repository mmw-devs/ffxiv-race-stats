/**
 * Lifecycle — 同步生命周期编排
 *
 * 一次同步 (单 PR / Issue) 走完整 8 步:
 *
 *   acquire  →  reflect  →  transform  →  diff/plan  →  apply  →  verify  →  audit
 *   (拉源)     (拉目标)    (字段映射)    (决策)       (写)       (验证)     (记录)
 *
 * - syncOnePullRequest: 同步单条 PR
 * - syncOneIssue:       同步单条 Issue
 * - syncAllPullRequests: 用 fetchAllPullRequests 全量回填
 * - syncAllIssues:      用 fetchAllIssues 全量回填
 */

import type {
  PullRequest,
  Issue,
  FeishuRecord,
  SyncTarget,
  SyncOutcome,
} from './domain/types.js';
import type { GitHubSource } from './ports/github-source.js';
import type { FeishuTarget } from './ports/feishu-target.js';
import type { AuditLogger } from './ports/audit-log.js';
import { acquirePullRequest, acquireIssue } from './usecases/acquire.js';
import { reflect } from './usecases/reflect.js';
import { prToFeishuFields, issueToFeishuFields } from './field-mapping.js';
import { buildPlan } from './usecases/plan.js';
import { apply } from './usecases/apply.js';
import { verify } from './usecases/verify.js';
import { buildAuditEntry } from './usecases/audit.js';
import { SyncError } from './errors.js';

export interface SyncDeps {
  github: GitHubSource;
  feishu: FeishuTarget;
  audit: AuditLogger;
  /** dry-run 模式: 算 plan 但不写, 不 verify */
  dryRun: boolean;
}

export async function syncOnePullRequest(
  number: number,
  deps: SyncDeps,
): Promise<SyncOutcome> {
  return await syncOne(number, 'pr', deps.github, deps.feishu, deps.audit, deps.dryRun);
}

export async function syncOneIssue(
  number: number,
  deps: SyncDeps,
): Promise<SyncOutcome> {
  return await syncOne(number, 'issue', deps.github, deps.feishu, deps.audit, deps.dryRun);
}

async function syncOne(
  number: number,
  target: SyncTarget,
  github: GitHubSource,
  feishu: FeishuTarget,
  audit: AuditLogger,
  dryRun: boolean,
): Promise<SyncOutcome> {
  const start = Date.now();
  let pr: PullRequest | Issue | null = null;
  let existing: FeishuRecord | null = null;
  try {
    // 1. acquire
    pr = target === 'pr'
      ? await acquirePullRequest(number, github)
      : await acquireIssue(number, github);

    // 2. reflect
    existing = await reflect(pr.id, target, feishu);

    // 3. transform (field-mapping)
    const sourceFields = target === 'pr'
      ? prToFeishuFields(pr as PullRequest)
      : issueToFeishuFields(pr as Issue);

    // 4. plan
    const plan = buildPlan(sourceFields, existing);

    // 5. apply (or dry-run)
    const recordId = dryRun
      ? (plan.recordId ?? null)
      : await apply(plan, target, sourceFields, feishu);

    // 6. verify (skip if dry-run or noop)
    if (!dryRun && plan.action !== 'noop' && recordId) {
      await verify(target, recordId, sourceFields, feishu);
    }

    // 7. audit
    const durationMs = Date.now() - start;
    await audit.log(buildAuditEntry({
      target,
      number,
      githubId: pr.id,
      action: plan.action,
      reason: dryRun ? `[dry-run] ${plan.reason}` : plan.reason,
      recordId: recordId ?? plan.recordId,
      previousState: existing?.fields['状态'],
      currentState: sourceFields['状态'],
      durationMs,
    }));

    return {
      action: plan.action,
      recordId: recordId ?? plan.recordId,
      reason: dryRun ? `[dry-run] ${plan.reason}` : plan.reason,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMsg = err instanceof SyncError ? err.toString() : String(err);
    await audit.log(buildAuditEntry({
      target,
      number,
      githubId: pr?.id ?? 'unknown',
      action: 'conflict',
      reason: `error: ${errorMsg}`,
      recordId: existing?.recordId,
      previousState: existing?.fields['状态'],
      currentState: pr ? (target === 'pr' ? (pr as PullRequest).mergedAt ? 'merged' : (pr as PullRequest).state : (pr as Issue).state === 'closed' ? 'closed' : 'open') : undefined,
      error: errorMsg,
      durationMs,
    }));
    // 失败也要把信息传递出去 (供 CI 决定)
    throw err;
  }
}

export async function syncAllPullRequests(deps: SyncDeps): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for await (const pr of deps.github.fetchAllPullRequests()) {
    const out = await syncOnePullRequest(pr.number, deps);
    outcomes.push(out);
  }
  return outcomes;
}

export async function syncAllIssues(deps: SyncDeps): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for await (const issue of deps.github.fetchAllIssues()) {
    const out = await syncOneIssue(issue.number, deps);
    outcomes.push(out);
  }
  return outcomes;
}
