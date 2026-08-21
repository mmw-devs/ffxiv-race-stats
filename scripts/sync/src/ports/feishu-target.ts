/**
 * Feishu Target — 端口定义
 *
 * 业务逻辑依赖此接口, 不直接调 lark-cli。
 * 阶段 2 adapters/lark-cli-feishu.ts 实现此接口。
 *
 * 关键设计:
 *  - findByGitHubId 的语义: "用 GitHub ID 字段查重; 没有就返回 null"
 *    (区别于 "没找到 == 错误", 业务逻辑依赖此语义去重)
 *  - createRecord / updateRecord 自动按 GitHub ID 写入
 *  - updateRecord 的 patch 字段是被改动的字段, 不需要传未改字段
 */

import type {
  FeishuRecord,
  FeishuRecordFields,
  FieldSchema,
  SyncTarget,
} from '../domain/types.js';

export interface FeishuTarget {
  /** 拉字段元信息 (用于字段映射) */
  listFields(target: SyncTarget): Promise<FieldSchema[]>;

  /** 用 GitHub ID (node_id) 查重, 找不到返回 null */
  findByGitHubId(githubId: string, target: SyncTarget): Promise<string | null>;

  /** 拉单条记录 (用于 verify / diff) */
  getRecord(target: SyncTarget, recordId: string): Promise<FeishuRecord | null>;

  /** 全量列出 (用于全量回填 + diff) */
  listRecords(target: SyncTarget): Promise<FeishuRecord[]>;

  /** 创建新记录, 返回 recordId */
  createRecord(target: SyncTarget, fields: FeishuRecordFields): Promise<string>;

  /** 增量更新记录 (patch 字段) */
  updateRecord(
    target: SyncTarget,
    recordId: string,
    patch: Partial<FeishuRecordFields>,
  ): Promise<void>;
}
