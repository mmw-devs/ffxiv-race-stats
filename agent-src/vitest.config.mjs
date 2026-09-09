// agent-src/vitest.config.mjs
// vitest 配置：覆盖 scripts/、.pi/scripts/、.pi/extensions/，使用 node 环境（脚本侧）
//
// PR-1 起新增：.pi/extensions/**/__tests__/**/*.test.ts（lark-bot extension 测试）
import { defineConfig } from "vitest/config";

export default defineConfig({
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