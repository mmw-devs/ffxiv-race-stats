// agent-src/vitest.config.mjs
// vitest 配置：覆盖 scripts/、.pi/scripts/、.pi/extensions/，使用 node 环境（脚本侧）
//
// PR-1 起新增：.pi/extensions/**/__tests__/**/*.test.ts（lark-bot extension 测试）
// PR-1-cleanup：resolve.alias 动态定位 typebox（避免硬编码绝对路径）
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

// 优先使用 PI Agent 自带的 typebox；本地/CI 未安装时退回项目依赖。
// 找不到时不注册 alias：scripts 测试仍可运行，只有 lark-bot extension 测试会因缺包失败。
function resolveTypebox() {
  const bases = [
    new URL("../.pi/npm/node_modules/.bin/_", import.meta.url),
    new URL("./node_modules/.bin/_", import.meta.url),
  ];
  for (const base of bases) {
    try {
      return createRequire(base).resolve("typebox");
    } catch {
      // 继续尝试下一个位置
    }
  }
  return undefined;
}

const typeboxEntry = resolveTypebox();

export default defineConfig({
  resolve: typeboxEntry
    ? {
        alias: {
          typebox: typeboxEntry,
        },
      }
    : {},
  test: {
    include: [
      "scripts/__tests__/**/*.test.ts",
      ".pi/scripts/**/__tests__/**/*.test.ts",
      ".pi/extensions/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 15000,
  },
});
