#!/usr/bin/env node
// 把构建期取到的 .astro-data/data.json 复制到构建产物；用于 build:preview。
// 复制前用 meta.json 的 sha256 验证快照与取数结果一致。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DATA_BUILD_DATA_PATH, DATA_BUILD_META_PATH, DATA_DIST_PATH } from '../shared/data-path.mjs'

const OUT = DATA_DIST_PATH

if (!existsSync(DATA_BUILD_DATA_PATH) || !existsSync(DATA_BUILD_META_PATH)) {
  console.error(
    `[copy-build-data] 找不到 ${DATA_BUILD_DATA_PATH} / ${DATA_BUILD_META_PATH}，请先运行 npm run fetch:build-data`
  )
  process.exitCode = 1
} else {
  try {
    const raw = readFileSync(DATA_BUILD_DATA_PATH, 'utf8')
    const meta = JSON.parse(readFileSync(DATA_BUILD_META_PATH, 'utf8'))
    const sha256 = createHash('sha256').update(raw).digest('hex')
    if (typeof meta.sha256 !== 'string' || meta.sha256 !== sha256) {
      throw new Error('构建数据快照哈希不匹配，拒绝复制')
    }

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, raw, 'utf8')
    console.log(`[copy-build-data] ${DATA_BUILD_DATA_PATH} → ${OUT}（${(raw.length / 1024).toFixed(1)} KB）`)
  } catch (e) {
    console.error(`[copy-build-data] ${e.message}`)
    process.exitCode = 1
  }
}
