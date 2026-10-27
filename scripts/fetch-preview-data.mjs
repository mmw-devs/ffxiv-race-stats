#!/usr/bin/env node
// 为预览构建（lighthouse / 本地 build:preview）准备 dist/data.json。
//
// 为什么是「取」而不是「存」：
//   dev 仓库曾长期保存一份占位数据（agent-src/public/data.json），它既是第二个事实源，
//   又会在数据契约变化后静默腐化——2026-10 就是因为这份镜像没跟上 `meta.dungeons`
//   的迁移，让预览站整站进入「数据加载失败」态。
//   现在 dev 不再持有任何数据副本：数据唯一事实源是 ops 仓库的 public/data.json，
//   生产站由 Cloudflare Pages 直接 `cp public/data.json dist/data.json`。
//   预览构建则从生产站取当前真实数据，天然与线上一致。
//
// 用法：
//   npm run build:preview          # 构建后自动执行本脚本
//
// 环境变量：
//   PREVIEW_DATA_URL  数据来源，默认 https://ffxiv-race-stats.pages.dev/data.json

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'

const SOURCE = (process.env.PREVIEW_DATA_URL || 'https://ffxiv-race-stats.pages.dev/data.json').trim()
const OUT = 'dist/data.json'
const ATTEMPTS = 3
const TIMEOUT_MS = 15_000
const REQUIRED_KEYS = ['meta', 'teams', 'news', 'broadcasters', 'notices', 'sponsors']

if (!/^https?:\/\//.test(SOURCE)) {
  console.error(`[preview-data] PREVIEW_DATA_URL 必须是绝对 URL，当前为：${SOURCE}`)
  process.exit(1)
}

if (!existsSync('dist')) {
  console.error('[preview-data] 找不到 dist/，请先执行 npm run build')
  process.exit(1)
}

let lastErr
for (let i = 1; i <= ATTEMPTS; i++) {
  try {
    const resp = await fetch(SOURCE, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    const raw = await resp.text()
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error('响应不是合法 JSON（可能拿到了 HTML 错误页）')
    }

    const missing = REQUIRED_KEYS.filter((k) => !(k in (data ?? {})))
    if (missing.length > 0) throw new Error(`数据缺少顶层字段：${missing.join(', ')}`)

    mkdirSync('dist', { recursive: true })
    writeFileSync(OUT, raw, 'utf8')
    console.log(`[preview-data] ${SOURCE} → ${OUT}（${(raw.length / 1024).toFixed(1)} KB）`)
    process.exit(0)
  } catch (e) {
    lastErr = e
    if (i < ATTEMPTS) console.warn(`[preview-data] 第 ${i} 次失败：${e.message}，重试…`)
  }
}

console.error(`[preview-data] 拉取预览数据失败（${ATTEMPTS} 次）：${lastErr?.message ?? lastErr}`)
console.error(`[preview-data] 来源：${SOURCE}`)
console.error('[preview-data] 如需改用其它来源，请设置 PREVIEW_DATA_URL')
process.exit(1)
