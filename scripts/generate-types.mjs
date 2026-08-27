#!/usr/bin/env node
/**
 * scripts/generate-types.mjs
 *
 * 从 agent-src/schema/root.schema.json 自动生成 types/race-data.d.ts。
 * CI 在 build-verify 前跑一次，开发者本地可手动 `npm run typegen` 刷新。
 *
 * 数据流：
 *   agent-src/schema/*.schema.json  (root 用 $ref 引用其他 schema)
 *       ↓
 *   json-schema-to-typescript compileFromFile()
 *       ↓
 *   types/race-data.d.ts
 *
 * 选型说明：用 compileFromFile 而不是 compile(schemaArray)，
 * 是因为 jstt 内部 @apidevtools/json-schema-ref-parser 不使用 schema 自身的
 * $id 作为 base URL 解析相对 $ref，必须依赖文件系统路径上下文。
 */

import { compileFromFile } from 'json-schema-to-typescript'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(__dirname, '..', 'agent-src', 'schema')
const ROOT_FILE = path.join(SCHEMA_DIR, 'root.schema.json')
const OUTPUT_DIR = path.resolve(__dirname, '..', 'types')
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'race-data.d.ts')

async function main() {
  const banner = `/**
 * 由 scripts/generate-types.mjs 自动生成 — 请勿手动编辑
 * 数据源：agent-src/schema/*.schema.json
 * 重新生成：npm run typegen
 */`

  const ts = await compileFromFile(ROOT_FILE, {
    bannerComment: banner + '\n',
    style: 'interface',
    declareExternallyReferenced: true,
    ignoreMinAndMaxItems: false,
  })

  await mkdir(OUTPUT_DIR, { recursive: true })
  await writeFile(OUTPUT_FILE, ts, 'utf8')
  console.log(`✓ 已生成 ${path.relative(process.cwd(), OUTPUT_FILE)}`)
}

main().catch(err => {
  console.error('✗ 类型生成失败：', err.message ?? err)
  process.exit(1)
})