#!/usr/bin/env node
// dev 预览站的 /data.json 反代注入（仅在 dev 仓库的 CF Pages 预览项目里跑）。
//
// 背景：
//   1. dev 仓库只在 `agent-src/public/data.json` 保留一份由 ops 同步来的副本，
//      它可能落后于真源（同步链路由 ops 仓库 sync-data-to-dev.yml 驱动）。
//   2. 该副本曾长期停留在旧数据契约（meta.dungeon 单数字符串），在客户端校验
//      收紧后让预览站直接进入「数据加载失败」态。
//   3. 预览站的价值是「看源码改动长什么样」，数据应该永远是生产站的真实数据。
//
// 为什么不直接写进 public/_redirects：
//   `dist/_redirects` 与生产站共用——build-dist.yml 会把整个 dist/ 推到 ops 仓库。
//   若在源文件里写死反代目标，生产站也会加载同一条规则，变成自己代理自己。
//   因此这条规则只在 dev 预览项目的构建流程末尾动态注入。
//
// 用法：
//   CF Pages（dev 仓库对应的预览项目）Build command 设为：
//     npm run build:dev-preview
//
// 环境变量：
//   PREVIEW_DATA_URL  反代目标，默认 https://ffxiv-race-stats.pages.dev/data.json

import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'dist/_redirects'
const TARGET = (process.env.PREVIEW_DATA_URL || 'https://ffxiv-race-stats.pages.dev/data.json').trim()

// 匹配 public/_redirects 里现有的 `/data.json  /data.json  200` 规则
const RULE = /^\/data\.json[ \t]+\S+[ \t]+200[ \t]*$/m

let src
try {
  src = readFileSync(FILE, 'utf8')
} catch {
  console.error(`[dev-preview] 找不到 ${FILE}，请先执行 npm run build`)
  process.exit(1)
}

if (!RULE.test(src)) {
  console.error(`[dev-preview] ${FILE} 中未找到 /data.json 规则，拒绝静默通过`)
  process.exit(1)
}

if (!/^https?:\/\//.test(TARGET)) {
  console.error(`[dev-preview] PREVIEW_DATA_URL 必须是绝对 URL，当前为：${TARGET}`)
  process.exit(1)
}

writeFileSync(FILE, src.replace(RULE, `/data.json    ${TARGET}    200`), 'utf8')
console.log(`[dev-preview] /data.json → ${TARGET}`)
