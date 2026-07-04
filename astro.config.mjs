import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'

export default defineConfig({
  integrations: [vue()],
  output: 'static',
  server: { host: '0.0.0.0', port: 4321 },
})
