import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'
import { DATA_SOURCE_URL, splitUrl } from './scripts/data-source.mjs'

// 真源 URL 拆成 origin + path，供 Vite 代理转发
const source = splitUrl(DATA_SOURCE_URL)

export default defineConfig({
  integrations: [vue()],
  output: 'static',
  server: { host: '0.0.0.0', port: 4321 },
  vite: {
    // dev 仓库不保存 data.json 副本（SSOT：唯一的源在 ops 仓库）。
    // 本地 `npm run dev` 时把 /data.json 转发到真源，直接看到当前真实数据。
    // 仅作用于 dev server；构建产物与预览站/生产站都不受影响。
    server: {
      proxy: {
        '/data.json': {
          target: source.origin,
          changeOrigin: true,
          rewrite: () => source.path,
        },
      },
    },
  },
})
