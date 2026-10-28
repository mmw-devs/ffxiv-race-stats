#!/usr/bin/env node
// 把构建期取到的 .astro-data/data.json 复制到构建产物；用于 build:preview。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DATA_DIST_PATH } from '../shared/data-path.mjs'

const SRC = '.astro-data/data.json'
const OUT = DATA_DIST_PATH

if (!existsSync(SRC)) {
  console.error(`[copy-build-data] 找不到 ${SRC}，请先运行 npm run fetch:build-data`)
  process.exitCode = 1
} else {
  try {
    const raw = readFileSync(SRC, 'utf8')
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, raw, 'utf8')
    console.log(`[copy-build-data] ${SRC} → ${OUT}（${(raw.length / 1024).toFixed(1)} KB）`)
  } catch (e) {
    console.error(`[copy-build-data] ${e.message}`)
    process.exitCode = 1
  }
}
