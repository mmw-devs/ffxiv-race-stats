// agent-src/vitest.config.mjs
// vitest 配置：覆盖 scripts/、.pi/scripts/、.pi/extensions/，使用 node 环境（脚本侧）
//
// PR-1 起新增：.pi/extensions/**/__tests__/**/*.test.ts（lark-bot extension 测试）
// PR-1-cleanup：resolve.alias 动态定位 typebox（避免硬编码绝对路径）
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

// 从 .pi/npm/node_modules/typebox 动态解析 typebox 入口
// Node.js require.resolve 用 cwd 相对路径查找，无需硬编码绝对路径
const requireFromPi = createRequire(
  new URL("../.pi/npm/node_modules/.bin/_", import.meta.url),
);
const typeboxEntry = requireFromPi.resolve("typebox");

export default defineConfig({
  resolve: {
    alias: {
      typebox: typeboxEntry,
    },
  },
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
