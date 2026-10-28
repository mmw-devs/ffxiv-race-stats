import { readFileSync, readdirSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'

const SCHEMA_DIR = new URL('../agent-src/schema/', import.meta.url)

/** 用仓库里的 JSON Schema 编译根校验器（Node / 构建期专用）。 */
export function createSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  for (const file of readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.schema.json'))) {
    const schema = JSON.parse(readFileSync(new URL(file, SCHEMA_DIR), 'utf8'))
    ajv.addSchema(schema, file)
  }
  const validate = ajv.getSchema('root.schema.json')
  if (!validate) throw new Error('无法编译 root.schema.json')
  return validate
}

export function formatSchemaErrors(validate) {
  return (validate.errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`)
    .join('；')
}
