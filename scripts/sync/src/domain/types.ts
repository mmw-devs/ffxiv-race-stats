/**
 * 领域类型 — GitHub PR/Issue + 飞书 Bitable Record
 *
 * 阶段 1: 纯类型定义, 不依赖任何 lark-cli / gh / zod
 * 阶段 2 起再 zod 校验
 *
 * 命名约定:
 *  - GitHub 类型: PascalCase (PullRequest, Issue)
 *  - 飞书字段: 字段名原样, 用字符串 key (fly feature, 不会随 field_rename 失效)
 *  - 同步动作: 'create' | 'update' | 'noop' | 'conflict'
 */

// ============ GitHub PullRequest ============

export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  mergedAt: string | null;
  author: { login: string };
  assignees: ReadonlyArray<{ login: string }>;
  labels: ReadonlyArray<{ name: string }>;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  /** GitHub node_id, e.g. "PR_kwDOS6dS4s7zdOIC" */
  id: string;
}

// ============ GitHub Issue ============

export interface Issue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: { login: string };
  assignees: ReadonlyArray<{ login: string }>;
  labels: ReadonlyArray<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  url: string;
  id: string;
}

// ============ 飞书 Bitable ============

export type SyncTarget = 'pr' | 'issue';

/**
 * 飞书 Bitable "状态" 字段的取值。
 * - 'open'    : PR/Issue 还在打开
 * - 'closed'  : PR/Issue 被关闭但未合并
 * - 'merged'  : PR 被合并 (Issue 不可能 merged)
 */
export type MergeStatus = 'open' | 'closed' | 'merged';

export interface FeishuRecordFields {
  '编号': number;
  '标题': string;
  '状态': MergeStatus;
  '作者': string | null;
  '负责人': string | null;
  '标签': string[] | null;
  '源分支': string | null;
  '目标分支': string | null;
  '创建时间': string;
  '更新时间': string;
  'URL': string;
  'GitHub ID': string;
  /** 关联 Issue (PR 表 → Issue 表), 飞书 link 字段 */
  '关联 Issue'?: ReadonlyArray<{ record_id: string }>;
}

export interface FeishuRecord {
  recordId: string;
  fields: FeishuRecordFields;
}

/** 字段元信息 (查询飞书表结构用) */
export interface FieldSchema {
  id: string;
  name: string;
  type: string;
  options?: ReadonlyArray<{ name: string }>;
}

// ============ Sync Plan ============

export type SyncAction = 'create' | 'update' | 'noop' | 'conflict';

export interface SyncPlan {
  action: SyncAction;
  /** update 时必填, create 时为空 */
  recordId?: string;
  /** create 时是 full payload, update 时是 patch */
  payload: Partial<FeishuRecordFields>;
  /** 决策原因 (写入 audit log) */
  reason: string;
}

/** 同步一行 (PR/Issue) 的最终结果 */
export interface SyncOutcome {
  action: SyncAction;
  recordId?: string;
  reason: string;
}
