/**
 * gh CLI 适配器 — 实现 GitHubSource 端口
 *
 * 安全 P0:
 *  - 不引入 execa
 *  - 子进程一律 spawn + argv 数组 (禁止 shell 字符串拼接)
 *  - 错误信息 redact (含路径 / 命令)
 */

import { spawn } from 'node:child_process';
import type { GitHubSource } from '../ports/github-source.js';
import type { PullRequest, Issue } from '../domain/types.js';
import { PullRequestSchema, IssueSchema } from '../domain/schemas.js';
import { NetworkError, ValidationError } from '../errors.js';

export interface GhCliOptions {
  /** gh CLI 路径, 默认 'gh' */
  ghPath?: string;
  /** 仓库 owner/name (e.g. "mmw-devs/ffxiv-race-stats"), 默认从环境读 */
  repo?: string;
}

const PR_FIELDS = [
  'number', 'title', 'state', 'labels', 'assignees', 'author',
  'headRefName', 'baseRefName', 'createdAt', 'updatedAt', 'url', 'id', 'mergedAt',
] as const;

const ISSUE_FIELDS = [
  'number', 'title', 'state', 'labels', 'assignees', 'author',
  'createdAt', 'updatedAt', 'url', 'id',
] as const;

export class GhCli implements GitHubSource {
  constructor(private readonly opts: GhCliOptions = {}) {}

  async fetchPullRequest(number: number): Promise<PullRequest> {
    const data = await this.runJson([
      'pr', 'view', String(number),
      '--json', PR_FIELDS.join(','),
    ]);
    return parsePullRequest(data);
  }

  async fetchIssue(number: number): Promise<Issue> {
    const data = await this.runJson([
      'issue', 'view', String(number),
      '--json', ISSUE_FIELDS.join(','),
    ]);
    return parseIssue(data);
  }

  async *fetchAllPullRequests(): AsyncIterable<PullRequest> {
    const data = await this.runJson([
      'pr', 'list', '--state', 'all', '--limit', '1000',
      '--json', PR_FIELDS.join(','),
    ]);
    if (!Array.isArray(data)) {
      throw new NetworkError('gh pr list: response is not array');
    }
    for (const item of data) {
      yield parsePullRequest(item);
    }
  }

  async *fetchAllIssues(): AsyncIterable<Issue> {
    const data = await this.runJson([
      'issue', 'list', '--state', 'all', '--limit', '1000',
      '--json', ISSUE_FIELDS.join(','),
    ]);
    if (!Array.isArray(data)) {
      throw new NetworkError('gh issue list: response is not array');
    }
    for (const item of data) {
      yield parseIssue(item);
    }
  }

  /**
   * 跑 gh CLI 一个子命令, 解析 JSON 输出
   * 失败抛 NetworkError (含 exit code + stderr 截断)
   */
  private async runJson(args: readonly string[]): Promise<unknown> {
    const repo = this.opts.repo ?? process.env.GITHUB_REPO;
    const fullArgs = repo ? [...args, '--repo', repo] : args;

    const ghPath = this.opts.ghPath ?? 'gh';
    return new Promise((resolve, reject) => {
      const proc = spawn(ghPath, fullArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new NetworkError(
            `gh ${args.slice(0, 3).join(' ')} exited ${code}: ${stderr.slice(0, 500)}`,
          ));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (err) {
            reject(new NetworkError(
              `gh ${args.slice(0, 3).join(' ')} non-JSON output (${stdout.length} bytes): ${stdout.slice(0, 200)}`,
              err,
            ));
          }
        }
      });
      proc.on('error', (err) => reject(new NetworkError(`gh spawn failed: ${err.message}`, err)));
    });
  }
}

function parsePullRequest(data: unknown): PullRequest {
  const result = PullRequestSchema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('PullRequest', result.error);
  }
  return result.data;
}

function parseIssue(data: unknown): Issue {
  const result = IssueSchema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Issue', result.error);
  }
  return result.data;
}
