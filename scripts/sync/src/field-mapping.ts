/**
 * 字段映射: GitHub PR/Issue → FeishuRecordFields
 *
 * 单一职责: 转换是纯函数, 没有副作用
 * 测试可独立跑 (用 fixture 验证)
 *
 * 字段映射约定:
 *  - 状态: PR mergedAt 存在 → 'merged'; 否则 'open' | 'closed'
 *  - 负责人: assignees 用 ', ' 连接 login
 *  - 标签: 直接映射 (select 字段接受 string[]; null 表示空)
 *  - 关联 Issue: 阶段 3 不写 (link 字段需要先 acquire)
 */

import type { PullRequest, Issue, FeishuRecordFields, MergeStatus } from './domain/types.js';

export function prToFeishuFields(pr: PullRequest): FeishuRecordFields {
  const status: MergeStatus = pr.mergedAt ? 'merged' : pr.state;
  return {
    '编号': pr.number,
    '标题': pr.title,
    '状态': status,
    '作者': pr.author.login,
    '负责人': pr.assignees.length > 0 ? pr.assignees.map((a) => a.login).join(', ') : null,
    '标签': pr.labels.length > 0 ? pr.labels.map((l) => l.name) : null,
    '源分支': pr.headRefName,
    '目标分支': pr.baseRefName,
    '创建时间': pr.createdAt,
    '更新时间': pr.updatedAt,
    'URL': pr.url,
    'GitHub ID': pr.id,
  };
}

export function issueToFeishuFields(issue: Issue): FeishuRecordFields {
  const status: MergeStatus = issue.state === 'closed' ? 'closed' : 'open';
  return {
    '编号': issue.number,
    '标题': issue.title,
    '状态': status,
    '作者': issue.author.login,
    '负责人': issue.assignees.length > 0 ? issue.assignees.map((a) => a.login).join(', ') : null,
    '标签': issue.labels.length > 0 ? issue.labels.map((l) => l.name) : null,
    '源分支': null,
    '目标分支': null,
    '创建时间': issue.createdAt,
    '更新时间': issue.updatedAt,
    'URL': issue.url,
    'GitHub ID': issue.id,
  };
}
