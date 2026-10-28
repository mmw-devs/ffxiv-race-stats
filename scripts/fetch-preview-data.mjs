#!/usr/bin/env node
// 为需要本地数据的构建（lighthouse / 本地 build:preview）准备构建产物数据文件。
//
// 读的是**真源**（ops 仓库的 public/data.json，见 scripts/data-source.mjs），
// 不读生产站制品、也不在仓库里保存副本——符合 SSOT：数据只有一份。
//
// 代价：构建需要出网。因此这里做了重试 + 超时 + 完整 schema 校验，失败会显式退出，
// 不会静默产出一个没有数据的构建产物（那种站会渲染成错误态，却在 CI 里悄悄通过）。
//
// 用法：
//   npm run build:preview
//
// 环境变量：
//   DATA_SOURCE_URL  覆盖数据来源（默认 ops 仓库 raw 地址）

import { writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { DATA_SOURCE_URL } from './data-source.mjs'
import { DATA_DIST_PATH } from '../shared/data-path.mjs'

const OUT = DATA_DIST_PATH
const OUT_DIR = dirname(OUT)
const ATTEMPTS = 3
const TIMEOUT_MS = 15_000
const SCHEMA_DIR = new URL('../agent-src/schema/', import.meta.url)

function createSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  for (const file of readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.schema.json'))) {
    const schema = JSON.parse(readFileSync(new URL(file, SCHEMA_DIR), 'utf8'))
    ajv.addSchema(schema, file)
  }
  const validate = ajv.getSchema('root.schema.json')
  if (!validate) throw new Error('无法编译 root.schema.json')
  return validate
}

async function main() {
  let validateSchema
  try {
    validateSchema = createSchemaValidator()
  } catch (e) {
    console.error(`[preview-data] 无法加载 agent-src/schema: ${e.message}`)
    return 1
  }

  if (!existsSync(OUT_DIR)) {
    console.error(`[preview-data] 找不到 ${OUT_DIR}/，请先执行 npm run build`)
    return 1
  }

  let lastErr
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const resp = await fetch(DATA_SOURCE_URL, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const raw = await resp.text()
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        throw new Error('响应不是合法 JSON（可能拿到了 HTML 错误页）')
      }

      if (!validateSchema(data)) {
        const details = (validateSchema.errors ?? [])
          .slice(0, 5)
          .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`)
        throw new Error(`数据未通过 schema 校验：${details.join('；')}`)
      }

      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(OUT, raw, 'utf8')
      console.log(`[preview-data] ${DATA_SOURCE_URL} → ${OUT}（${(raw.length / 1024).toFixed(1)} KB）`)
      return 0
    } catch (e) {
      lastErr = e
      if (attempt < ATTEMPTS) {
        console.warn(`[preview-data] 第 ${attempt} 次失败：${e.message}，重试…`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  console.error(`[preview-data] 拉取真源失败（${ATTEMPTS} 次）：${lastErr?.message ?? lastErr}`)
  console.error(`[preview-data] 来源：${DATA_SOURCE_URL}`)
  console.error('[preview-data] 可用 DATA_SOURCE_URL 指向其它数据文件')
  return 1
}

process.exitCode = await main()
