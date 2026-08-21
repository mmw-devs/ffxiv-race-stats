/**
 * Fixture loader — 读 JSON fixture + 类型断言
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type {
  PullRequest,
  Issue,
  FeishuRecord,
} from '../../src/domain/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

export function prFixture(name: string): PullRequest {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as PullRequest;
}

export function issueFixture(name: string): Issue {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as Issue;
}

export function feishuRecordFixture(name: string): FeishuRecord {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as FeishuRecord;
}
