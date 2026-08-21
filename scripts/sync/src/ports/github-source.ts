/**
 * GitHub Source — 端口定义
 *
 * 业务逻辑依赖此接口, 不直接调 gh CLI。
 * 阶段 2 adapters/gh-cli.ts 实现此接口。
 */

import type { PullRequest, Issue } from '../domain/types.js';

export interface GitHubSource {
  /** 拉单条 PR (#N) */
  fetchPullRequest(number: number): Promise<PullRequest>;

  /** 拉单条 Issue (#N) */
  fetchIssue(number: number): Promise<Issue>;

  /** 全量 PR (用于全量回填) */
  fetchAllPullRequests(): AsyncIterable<PullRequest>;

  /** 全量 Issue (用于全量回填) */
  fetchAllIssues(): AsyncIterable<Issue>;
}
