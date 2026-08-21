/**
 * vitest 配置 — scripts/sync 测试
 *
 * - include: 用 vitest 默认 glob (**\/*.{test,spec}.ts)
 * - exclude: tests/e2e (e2e 用独立 npm script 跑)
 * - globals: false (显式 import describe/test/expect)
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
});
