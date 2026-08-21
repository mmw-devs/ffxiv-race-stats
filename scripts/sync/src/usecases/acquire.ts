/**
 * Acquire — 拉源数据 (GitHub)
 */

import type { PullRequest, Issue } from '../domain/types.js';
import type { GitHubSource } from '../ports/github-source.js';

export async function acquirePullRequest(
  number: number,
  source: GitHubSource,
): Promise<PullRequest> {
  return await source.fetchPullRequest(number);
}

export async function acquireIssue(
  number: number,
  source: GitHubSource,
): Promise<Issue> {
  return await source.fetchIssue(number);
}
