#!/usr/bin/env node
// 构建期取数：把已校验的 data.json 写到 .astro-data/，供 BaseLayout 生成首屏 head。
// 只在 build:preview / build-dist 这类需要 SEO 的构建里运行；普通 npm run build 可没有该文件。

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { RaceDataFetchError, fetchRaceData } from './fetch-race-data.mjs'

const OUT = '.astro-data/data.json'
const ALLOW_MISSING = process.argv.includes('--allow-missing')

if (ALLOW_MISSING) {
  // 不允许把上一轮残留的 head 数据当成本轮成功结果。
  rmSync(OUT, { force: true })
}

try {
  const { raw } = await fetchRaceData()
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, raw, 'utf8')
  console.log(`[build-data] → ${OUT}（${(raw.length / 1024).toFixed(1)} KB）`)
} catch (e) {
  const transportOnly = ALLOW_MISSING && e instanceof RaceDataFetchError && e.kind === 'transport'
  if (transportOnly) {
    console.warn(`[build-data] 取数失败，使用 fallback head：${e.message}`)
  } else {
    console.error(`[build-data] ${e.message}`)
    process.exitCode = 1
  }
}
