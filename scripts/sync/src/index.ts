#!/usr/bin/env tsx
/**
 * scripts/sync — GitHub Issue/PR → 飞书多维表格 同步脚本
 *
 * 同步生命周期:
 *   Observe → Acquire → Reflect → Diff → Plan → Apply → Verify → Audit
 *
 * 阶段 0: 骨架 (hello world + 参数解析)
 * 阶段 1: 领域类型 + 端口定义
 * 阶段 2: 适配器 (gh CLI + lark-cli 子进程)
 * 阶段 3: 生命周期 8 步 + 编排
 * 阶段 4: 测试 (fixture + integration + e2e)
 * 阶段 5: CI 集成
 * 阶段 6: 灰度 + 删旧脚本
 */

import { parseArgs, type SyncArgs } from './cli.js';

async function main(): Promise<void> {
  const args: SyncArgs = parseArgs(process.argv.slice(2));

  // ===== 阶段 0: 骨架 (后续会被 lifecycle.ts 替换) =====
  console.log('[scripts/sync] starting');
  console.log('[scripts/sync] command:    ', args.command);
  console.log('[scripts/sync] number:     ', args.number ?? '(全量)');
  console.log('[scripts/sync] dryRun:     ', args.dryRun);
  console.log('[scripts/sync] profile:    ', args.profile);
  console.log('[scripts/sync] baseToken:  ', redact(args.baseToken));
  console.log('[scripts/sync] prTable:    ', args.prTableId);
  console.log('[scripts/sync] issueTable: ', args.issueTableId);
  console.log('[scripts/sync] OK (阶段 0: 骨架)');
}

/** 抹除敏感字段（demo 用，阶段 1 会有专门 redact 模块） */
function redact(value: string | undefined): string {
  if (!value) return '(unset)';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

main().catch((err) => {
  console.error('[scripts/sync] FATAL:', err);
  process.exit(1);
});
