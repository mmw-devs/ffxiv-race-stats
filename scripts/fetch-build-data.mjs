#!/usr/bin/env node
// 构建期取数：把已校验的 data.json 与来源/哈希快照写到 .astro-data/，
// 供 BaseLayout 生成首屏 head，并让构建能验证快照未被篡改。
// 只在 build:preview / build-dist 这类需要 SEO 的构建里运行；普通 npm run build 可没有该文件。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { DATA_SOURCE_URL } from './data-source.mjs'
import { DATA_BUILD_DATA_PATH, DATA_BUILD_META_PATH } from '../shared/data-path.mjs'
import { RaceDataFetchError, fetchRaceData } from './fetch-race-data.mjs'

const ALLOW_MISSING = process.argv.includes('--allow-missing')
const PUBLIC_DIR = resolve(process.cwd(), 'public')

function assertLocalAsset(value, label) {
  if (typeof value !== 'string' || !value.startsWith('/')) return
  const file = resolve(PUBLIC_DIR, value.slice(1))
  if (!file.startsWith(PUBLIC_DIR + sep)) throw new Error(`${label} 路径越界: ${value}`)
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`${label} 不存在: ${value}`)
  }
}

function assertContentAssets(data) {
  const content = data?.content
  const media = content?.media
  assertLocalAsset(media?.heroVideo, 'content.media.heroVideo')
  assertLocalAsset(media?.heroPoster, 'content.media.heroPoster')
  assertLocalAsset(content?.seo?.ogImage, 'content.seo.ogImage')
}

if (ALLOW_MISSING) {
  // 不允许把上一轮残留的 head 数据当成本轮成功结果。
  rmSync(DATA_BUILD_DATA_PATH, { force: true })
  rmSync(DATA_BUILD_META_PATH, { force: true })
}

try {
  const { raw, data } = await fetchRaceData()
  assertContentAssets(data)

  const sha256 = createHash('sha256').update(raw).digest('hex')
  const meta = {
    sourceUrl: DATA_SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    sha256,
  }

  mkdirSync(dirname(DATA_BUILD_DATA_PATH), { recursive: true })
  writeFileSync(DATA_BUILD_DATA_PATH, raw, 'utf8')
  writeFileSync(DATA_BUILD_META_PATH, JSON.stringify(meta, null, 2) + '\n', 'utf8')
  console.log(
    `[build-data] → ${DATA_BUILD_DATA_PATH}（${(raw.length / 1024).toFixed(1)} KB，sha256 ${sha256.slice(0, 12)}）`
  )
} catch (e) {
  const transportOnly = ALLOW_MISSING && e instanceof RaceDataFetchError && e.kind === 'transport'
  if (transportOnly) {
    console.warn(`[build-data] 取数失败，使用 fallback head：${e.message}`)
  } else {
    console.error(`[build-data] ${e.message}`)
    process.exitCode = 1
  }
}
