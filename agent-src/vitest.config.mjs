// agent-src/vitest.config.mjs
// vitest 配置：覆盖 scripts/ 和 .pi/scripts/，使用 node 环境（脚本侧）
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/__tests__/**/*.test.ts", ".pi/scripts/**/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});