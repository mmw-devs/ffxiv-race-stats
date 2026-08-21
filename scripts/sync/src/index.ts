#!/usr/bin/env tsx
/**
 * scripts/sync — GitHub Issue/PR → 飞书多维表格 同步脚本
 *
 * 同步生命周期 (阶段 3):
 *   acquire → reflect → transform → plan → apply → verify → audit
 */

import { parseArgs, type SyncArgs } from './cli.js';
import { GhCli } from './adapters/gh-cli.js';
import { LarkCliFeishu } from './adapters/lark-cli-feishu.js';
import { AuditStdout } from './adapters/audit-stdout.js';
import {
  syncOnePullRequest,
  syncOneIssue,
  syncAllPullRequests,
  syncAllIssues,
  type SyncDeps,
} from './lifecycle.js';

async function main(): Promise<void> {
  const args: SyncArgs = parseArgs(process.argv.slice(2));

  const github = new GhCli();
  const feishu = new LarkCliFeishu({
    profile: args.profile,
    baseToken: args.baseToken,
    prTableId: args.prTableId,
    issueTableId: args.issueTableId,
  });
  const audit = new AuditStdout();

  const deps: SyncDeps = {
    github,
    feishu,
    audit,
    dryRun: args.dryRun,
  };

  console.error(`[scripts/sync] starting ${args.command} ${args.dryRun ? '[dry-run]' : ''}`);

  if (args.command === 'pr') {
    if (args.number === undefined) {
      throw new Error('pr 命令需要 number');
    }
    const out = await syncOnePullRequest(args.number, deps);
    console.error(`[scripts/sync] PR #${args.number}: ${out.action}${out.recordId ? ` (recordId=${out.recordId})` : ''} — ${out.reason}`);
  } else if (args.command === 'issue') {
    if (args.number === undefined) {
      throw new Error('issue 命令需要 number');
    }
    const out = await syncOneIssue(args.number, deps);
    console.error(`[scripts/sync] Issue #${args.number}: ${out.action}${out.recordId ? ` (recordId=${out.recordId})` : ''} — ${out.reason}`);
  } else {
    console.error('[scripts/sync] 全量回填 PRs ...');
    const prOuts = await syncAllPullRequests(deps);
    console.error(`[scripts/sync] PRs: ${prOuts.length} 条`);
    console.error('[scripts/sync] 全量回填 Issues ...');
    const issueOuts = await syncAllIssues(deps);
    console.error(`[scripts/sync] Issues: ${issueOuts.length} 条`);
  }

  console.error('[scripts/sync] OK');
}

main().catch((err) => {
  console.error('[scripts/sync] FATAL:', err);
  process.exit(1);
});
