import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'

export default defineConfig({
  integrations: [vue()],
  output: 'static',
  server: { host: '0.0.0.0', port: 4321 },
  vite: {
    // data.json 只在仓库里保留一份「由 ops 同步来的副本」，供构建/CI 使用；
    // 本地 `npm run dev` 时把 /data.json 代理到生产站，直接看到线上最新数据。
    // 仅作用于 dev server，构建产物不受影响（预览站由 _redirects 反代，生产站自带 data.json）。
    server: {
      proxy: {
        '/data.json': {
          target: process.env.PREVIEW_DATA_ORIGIN || 'https://ffxiv-race-stats.pages.dev',
          changeOrigin: true,
        },
      },
    },
  },
})
