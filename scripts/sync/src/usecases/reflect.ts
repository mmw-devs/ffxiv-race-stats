/**
 * Reflect — 拉目标数据 (飞书现状)
 */

import type { FeishuRecord, SyncTarget } from '../domain/types.js';
import type { FeishuTarget } from '../ports/feishu-target.js';

/**
 * 用 GitHub ID 查飞书侧现状
 * 返回 null 表示飞书侧没有该记录 (即新增场景)
 */
export async function reflect(
  githubId: string,
  target: SyncTarget,
  feishu: FeishuTarget,
): Promise<FeishuRecord | null> {
  const recordId = await feishu.findByGitHubId(githubId, target);
  if (!recordId) return null;
  return await feishu.getRecord(target, recordId);
}
