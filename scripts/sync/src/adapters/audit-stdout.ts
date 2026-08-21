/**
 * Audit Log: 写到 stdout (JSON Lines)
 *
 * 适配器层:
 *  - 实现 AuditLogger 端口
 *  - 字段 redact (defense in depth: 域模型已经保证, 输出层再 strip 一遍)
 *  - 不写敏感字段 (token / secret / cookie)
 *
 * 用法:
 *   const audit = new AuditStdout();
 *   await audit.log({ timestamp: new Date().toISOString(), ... });
 */

import type { AuditEntry, AuditLogger } from '../ports/audit-log.js';

const REDACT_PATTERNS: ReadonlyArray<RegExp> = [
  // Bearer / app_secret / token / cookie
  /Bearer\s+[A-Za-z0-9._\-+/=]+/g,
  /app[_-]?secret["':\s=]+[A-Za-z0-9_\-]+/gi,
  /token["':\s=]+[A-Za-z0-9._\-+/=]{6,}/gi,
  /cookie["':\s=]+[^\s"',][^"',\s]*/gi,
  // 飞书 app_id (cli_xxxx)
  /cli_[a-zA-Z0-9]{8,}/g,
  // GitHub PAT (ghp_xxx, ghs_xxx, etc.)
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
];

export class AuditStdout implements AuditLogger {
  async log(entry: AuditEntry): Promise<void> {
    const redacted = redactEntry(entry);
    process.stdout.write(JSON.stringify({ kind: 'audit', ...redacted }) + '\n');
  }

  async flush(): Promise<void> {
    // stdout 是流式, 无需 flush
  }
}

function redactEntry(entry: AuditEntry): AuditEntry {
  const cloned: AuditEntry = { ...entry };
  if (cloned.error) {
    cloned.error = redactString(cloned.error);
  }
  if (cloned.reason) {
    cloned.reason = redactString(cloned.reason);
  }
  return cloned;
}

function redactString(s: string): string {
  let out = s;
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, '***');
  }
  return out;
}
