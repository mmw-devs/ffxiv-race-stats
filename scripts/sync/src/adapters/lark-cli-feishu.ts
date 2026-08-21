/**
 * lark-cli 适配器 — 实现 FeishuTarget 端口
 *
 * 安全 P0:
 *  - 不引入 execa
 *  - 子进程一律 spawn + argv 数组 (禁止 shell 字符串拼接)
 *  - 错误信息 redact
 *  - 默认 as=bot (CI 通道), 可选 as=user (本地 personal)
 */

import { spawn } from 'node:child_process';
import type { FeishuTarget } from '../ports/feishu-target.js';
import type {
  FeishuRecord,
  FeishuRecordFields,
  FieldSchema,
  SyncTarget,
} from '../domain/types.js';
import { FeishuRecordSchema, FieldSchemaSchema } from '../domain/schemas.js';
import { NetworkError, ValidationError } from '../errors.js';

export type FeishuIdentity = 'bot' | 'user';

export interface LarkCliFeishuOptions {
  profile: string;
  baseToken: string;
  prTableId: string;
  issueTableId: string;
  /** 身份: 默认 'bot' (CI 通道); 'user' 仅本地 personal */
  as?: FeishuIdentity;
  /** lark-cli 路径, 默认 'lark-cli' */
  larkCliPath?: string;
}

/** 用 alias 类型避免与全局 String 冲突 */
interface LarkListResponse {
  data?: {
    record_id_list?: unknown[];
    items?: unknown[];
  };
}

interface LarkRecordResponse {
  data?: {
    record?: {
      record_id?: string;
    };
  };
}

export class LarkCliFeishu implements FeishuTarget {
  private readonly as: FeishuIdentity;

  constructor(private readonly opts: LarkCliFeishuOptions) {
    this.as = opts.as ?? 'bot';
  }

  private tableId(target: SyncTarget): string {
    return target === 'pr' ? this.opts.prTableId : this.opts.issueTableId;
  }

  async listFields(target: SyncTarget): Promise<FieldSchema[]> {
    const output = await this.runJson([
      'base', '+field-list',
      '--base-token', this.opts.baseToken,
      '--table-id', this.tableId(target),
      '--format', 'json',
      '--as', this.as,
      '--profile', this.opts.profile,
    ]);
    const items = this.extractArray(output, 'data.items');
    return items.map((item) => parseFieldSchema(item));
  }

  async findByGitHubId(githubId: string, target: SyncTarget): Promise<string | null> {
    const output = await this.runJson([
      'base', '+record-list',
      '--base-token', this.opts.baseToken,
      '--table-id', this.tableId(target),
      '--filter-json', JSON.stringify({
        logic: 'and',
        conditions: [['GitHub ID', '==', githubId]],
      }),
      '--format', 'json',
      '--as', this.as,
      '--profile', this.opts.profile,
    ]);
    const list = output as LarkListResponse;
    const ids = list.data?.record_id_list;
    if (Array.isArray(ids) && ids.length > 0 && typeof ids[0] === 'string') {
      return ids[0];
    }
    return null;
  }

  async getRecord(target: SyncTarget, recordId: string): Promise<FeishuRecord | null> {
    const output = await this.runJson([
      'base', '+record-get',
      '--base-token', this.opts.baseToken,
      '--table-id', this.tableId(target),
      '--record-id', recordId,
      '--format', 'json',
      '--as', this.as,
      '--profile', this.opts.profile,
    ]);
    return parseFeishuRecord(output);
  }

  async listRecords(target: SyncTarget): Promise<FeishuRecord[]> {
    const output = await this.runJson([
      'base', '+record-list',
      '--base-token', this.opts.baseToken,
      '--table-id', this.tableId(target),
      '--page-size', '500',
      '--format', 'json',
      '--as', this.as,
      '--profile', this.opts.profile,
    ]);
    const items = this.extractArray(output, 'data.items');
    return items.map((item) => {
      const obj = item as { record_id: string; fields: unknown };
      return parseFeishuRecord({ recordId: obj.record_id, fields: obj.fields });
    });
  }

  async createRecord(target: SyncTarget, fields: FeishuRecordFields): Promise<string> {
    const output = await this.runJson([
      'base', '+record-create',
      '--base-token', this.opts.baseToken,
      '--table-id', this.tableId(target),
      '--json', JSON.stringify({ fields }),
      '--as', this.as,
      '--profile', this.opts.profile,
    ]);
    const resp = output as LarkRecordResponse;
    const recordId = resp.data?.record?.record_id;
    if (typeof recordId !== 'string') {
      throw new NetworkError('lark-cli +record-create: no record_id in response');
    }
    return recordId;
  }

  async updateRecord(
    target: SyncTarget,
    recordId: string,
    patch: Partial<FeishuRecordFields>,
  ): Promise<void> {
    await this.runJson([
      'base', '+record-update',
      '--base-token', this.opts.baseToken,
      '--table-id', this.tableId(target),
      '--record-id', recordId,
      '--json', JSON.stringify({ fields: patch }),
      '--as', this.as,
      '--profile', this.opts.profile,
    ]);
  }

  /**
   * 跑 lark-cli 一个子命令, 解析 JSON 输出
   * 失败抛 NetworkError (含 exit code + stderr 截断)
   */
  private async runJson(args: readonly string[]): Promise<unknown> {
    const larkCliPath = this.opts.larkCliPath ?? 'lark-cli';
    return new Promise((resolve, reject) => {
      const proc = spawn(larkCliPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new NetworkError(
            `lark-cli ${args.slice(0, 3).join(' ')} exited ${code}: ${stderr.slice(0, 500)}`,
          ));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (err) {
            reject(new NetworkError(
              `lark-cli ${args.slice(0, 3).join(' ')} non-JSON output (${stdout.length} bytes): ${stdout.slice(0, 200)}`,
              err,
            ));
          }
        }
      });
      proc.on('error', (err) => reject(new NetworkError(`lark-cli spawn failed: ${err.message}`, err)));
    });
  }

  private extractArray(output: unknown, path: string): unknown[] {
    const parts = path.split('.');
    let cur: unknown = output;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        throw new NetworkError(`lark-cli response missing path: ${path}`);
      }
    }
    if (!Array.isArray(cur)) {
      throw new NetworkError(`lark-cli response path ${path} is not array`);
    }
    return cur;
  }
}

function parseFieldSchema(data: unknown): FieldSchema {
  const result = FieldSchemaSchema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('FieldSchema', result.error);
  }
  return result.data;
}

function parseFeishuRecord(data: unknown): FeishuRecord {
  const result = FeishuRecordSchema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('FeishuRecord', result.error);
  }
  return result.data;
}
