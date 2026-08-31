// vitest.config.mjs — agent-src 校验脚本单元测试配置
// 独立于根目录 vitest（根目录用于 scripts/sync/ 测试）
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: '.',
    include: ['scripts/__tests__/**/*.test.js'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
  },
})