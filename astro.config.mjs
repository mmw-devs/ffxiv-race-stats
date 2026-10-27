import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'

export default defineConfig({
  integrations: [vue()],
  output: 'static',
  server: { host: '0.0.0.0', port: 4321 },
  vite: {
    // dev 仓库不再保存数据副本，本地 `npm run dev` 时把 /data.json 代理到生产站，
    // 拿真实的当前数据。仅作用于 dev server，构建产物不受影响（生产/预览站由 _redirects 处理）。
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
