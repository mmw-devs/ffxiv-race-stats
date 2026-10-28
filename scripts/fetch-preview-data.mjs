#!/usr/bin/env node
// 为 lighthouse / 手动预览准备 dist/data.json。
//
// 读的是**真源**（ops 仓库的 public/data.json，见 scripts/data-source.mjs），
// 不读生产站制品、也不在仓库里保存副本——符合 SSOT：数据只有一份。
// 取数后会跑完整 schema 校验；失败直接退出，不会产出没有数据的构建产物。
//
// 用法：
//   npm run fetch:preview-data
//
// 环境变量：
//   DATA_SOURCE_URL  覆盖数据来源（默认 ops 仓库 raw 地址）

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DATA_SOURCE_URL } from './data-source.mjs'
import { DATA_DIST_PATH } from '../shared/data-path.mjs'
import { fetchRaceData } from './fetch-race-data.mjs'

const OUT = DATA_DIST_PATH
const OUT_DIR = dirname(OUT)

if (!existsSync(OUT_DIR)) {
  console.error(`[preview-data] 找不到 ${OUT_DIR}/，请先执行 npm run build`)
  process.exitCode = 1
} else {
  try {
    const { raw } = await fetchRaceData()
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(OUT, raw, 'utf8')
    console.log(`[preview-data] ${DATA_SOURCE_URL} → ${OUT}（${(raw.length / 1024).toFixed(1)} KB）`)
  } catch (e) {
    console.error(`[preview-data] ${e.message}`)
    process.exitCode = 1
  }
}
