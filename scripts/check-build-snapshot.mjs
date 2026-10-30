#!/usr/bin/env node
// 在 Astro 进入渲染前校验构建期 SEO 快照。
// 没有快照时允许 fallback；有快照但 meta/hash/seo 不合法时提前失败，
// 避免把错误拖到 Astro 渲染阶段（Windows 下还可能伴随 libuv 断言噪音）。

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_BUILD_DATA_PATH, DATA_BUILD_META_PATH } from '../shared/data-path.mjs'

const dataPath = join(process.cwd(), DATA_BUILD_DATA_PATH)
if (!existsSync(dataPath)) {
  console.log('[build-snapshot] 无构建期快照，使用 fallback head')
  process.exitCode = 0
} else {
  try {
    const metaPath = join(process.cwd(), DATA_BUILD_META_PATH)
    if (!existsSync(metaPath)) throw new Error(`缺少 ${DATA_BUILD_META_PATH}`)

    const raw = readFileSync(dataPath, 'utf8')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const sha256 = createHash('sha256').update(raw).digest('hex')
    if (typeof meta.sha256 !== 'string' || meta.sha256 !== sha256) {
      throw new Error('构建数据快照哈希不匹配')
    }

    const data = JSON.parse(raw)
    const seo = data?.content?.seo
    if (
      !seo ||
      typeof seo.title !== 'string' ||
      typeof seo.description !== 'string' ||
      (seo.ogImage !== undefined && typeof seo.ogImage !== 'string')
    ) {
      throw new Error('快照缺少合法的 content.seo')
    }
    console.log(`[build-snapshot] 快照校验通过（${(raw.length / 1024).toFixed(1)} KB）`)
  } catch (e) {
    console.error(`[build-snapshot] ${e.message}`)
    process.exitCode = 1
  }
}
