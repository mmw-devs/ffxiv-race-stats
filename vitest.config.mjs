import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // 避免默认 fork 池在受限环境中 spawn 子进程；纯函数测试用线程池足够
    pool: 'threads',
  },
})
