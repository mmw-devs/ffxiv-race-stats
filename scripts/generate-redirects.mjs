#!/usr/bin/env node
// 生成 public/_redirects 的 /data.json 同源规则；用 --check 只校验不写入。
//
// 路径常量来自 shared/data-path.mjs，避免 _redirects 与前端 fetch 各写一份。

import { readFileSync, writeFileSync } from 'node:fs'
import { DATA_PUBLIC_PATH } from '../shared/data-path.mjs'

const CHECK = process.argv.includes('--check')
const target = new URL('../public/_redirects', import.meta.url)

const expected = `# ${DATA_PUBLIC_PATH}    ${DATA_PUBLIC_PATH}    200
# Astro build 会自动把本文件复制到 dist/_redirects
# 显式路由 ${DATA_PUBLIC_PATH}，避免 CF Pages 默认 SPA fallback
# 把 ${DATA_PUBLIC_PATH} 请求重写到 index.html（HTML）导致 fetch 拿到非 JSON 内容
${DATA_PUBLIC_PATH}    ${DATA_PUBLIC_PATH}    200
`

if (CHECK) {
  let actual = ''
  try {
    actual = readFileSync(target, 'utf8')
  } catch {
    // 缺失按不一致处理
  }
  if (actual.replace(/\r\n/g, '\n') !== expected) {
    console.error('[data-path] public/_redirects 与 shared/data-path.mjs 不一致')
    console.error('[data-path] 运行 `npm run data-path:sync` 重新生成')
    process.exit(1)
  }
  console.log('[data-path] public/_redirects 与 shared/data-path.mjs 一致')
} else {
  writeFileSync(target, expected, 'utf8')
  console.log(`[data-path] 已生成 public/_redirects（${DATA_PUBLIC_PATH}）`)
}
