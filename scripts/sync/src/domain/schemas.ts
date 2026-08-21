/**
 * zod schemas — 校验领域类型
 *
 * 阶段 1: 只校验, 不转换
 * 适配器 (阶段 2) 从 gh CLI JSON 输出 / lark-cli JSON 输出拉数据时
 * 用这些 schema 验证, 拒绝腐烂数据
 */

import { z } from 'zod';

export const PullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  mergedAt: z.string().nullable(),
  author: z.object({ login: z.string() }),
  assignees: z.array(z.object({ login: z.string() })),
  labels: z.array(z.object({ name: z.string() })),
  headRefName: z.string(),
  baseRefName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  url: z.string().url(),
  id: z.string(),
});

export const IssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  author: z.object({ login: z.string() }),
  assignees: z.array(z.object({ login: z.string() })),
  labels: z.array(z.object({ name: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
  url: z.string().url(),
  id: z.string(),
});

export const MergeStatusSchema = z.enum(['open', 'closed', 'merged']);

export const FeishuRecordFieldsSchema = z.object({
  '编号': z.number(),
  '标题': z.string(),
  '状态': MergeStatusSchema,
  '作者': z.string().nullable(),
  '负责人': z.string().nullable(),
  '标签': z.array(z.string()).nullable(),
  '源分支': z.string().nullable(),
  '目标分支': z.string().nullable(),
  '创建时间': z.string(),
  '更新时间': z.string(),
  'URL': z.string(),
  'GitHub ID': z.string(),
  '关联 Issue': z.array(z.object({ record_id: z.string() })).optional(),
});

export const FeishuRecordSchema = z.object({
  recordId: z.string(),
  fields: FeishuRecordFieldsSchema,
});

export const FieldSchemaSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  options: z.array(z.object({ name: z.string() })).optional(),
});

/**
 * gh CLI 输出可能字段缺失或类型不对, 解析时就抛错
 * (集中在 adapters/gh-cli.ts 调用)
 */
export type ParsedPullRequest = z.infer<typeof PullRequestSchema>;
export type ParsedIssue = z.infer<typeof IssueSchema>;
export type ParsedFeishuRecord = z.infer<typeof FeishuRecordSchema>;
