#!/usr/bin/env node
// 构建期取数：把已校验的 data.json 写到 .astro-data/，供 BaseLayout 生成首屏 head。
// 只在 build:preview / build-dist 这类需要 SEO 的构建里运行；普通 npm run build 可没有该文件。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fetchRaceData } from './fetch-race-data.mjs'

const OUT = '.astro-data/data.json'

try {
  const { raw } = await fetchRaceData()
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, raw, 'utf8')
  console.log(`[build-data] → ${OUT}（${(raw.length / 1024).toFixed(1)} KB）`)
} catch (e) {
  console.error(`[build-data] ${e.message}`)
  process.exitCode = 1
}
