#!/usr/bin/env node

/**
 * 预览链接自动构造 Extension
 *
 * 设计文档: docs/operations-system-design.md §5.4 "预览链接自动构造"
 *
 * Cloudflare Pages 分支预览 URL 格式:
 *   https://<sanitized-branch>.ffxiv-race-stats.pages.dev
 *
 * 分支名净化规则:
 *   - / → -
 *   - 其他非字母数字字符 → -
 *   - 全小写
 *
 * ⚠️ 长度限制: Cloudflare Pages 分支别名截断到 28 字符。
 * content- 前缀占 8 字符，因此 content/ 后面的部分 ≤ 20 字符。
 *
 * 示例:
 *   content/update-t1-p5              → content-update-t1-p5.ffxiv-race-stats.pages.dev  (18 chars ✅)
 *   content/reorder-ranks             → content-reorder-ranks.ffxiv-race-stats.pages.dev (21 chars ✅)
 *   content/reorder-ranks-clear-first → TRUNCATED to content-reorder-ranks-clear (35 chars ❌)
 *
 * 注意: 部署 URL 使用 Cloudflare 随机分配的 hash（如 be74f6a3.ffxiv-race-stats.pages.dev），
 * 不可预测，与 git commit hash 无关。始终使用分支别名格式。
 */

function getPreviewUrl(branchName) {
  const sanitized = branchName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  // 28-char Cloudflare limit
  const truncated = sanitized.slice(0, 28);
  return `https://${truncated}.ffxiv-race-stats.pages.dev`;
}

module.exports = { getPreviewUrl };
