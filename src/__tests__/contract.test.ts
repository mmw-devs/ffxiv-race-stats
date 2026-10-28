import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { validateRaceData } from '../utils/validateRaceData'
import { SECTIONS } from '../sections'

const SCHEMA_DIR = fileURLToPath(new URL('../../agent-src/schema/', import.meta.url))
const FIXTURE_DIR = fileURLToPath(new URL('../../agent-src/scripts/__tests__/fixtures/', import.meta.url))
const CONSTANTS_PATH = fileURLToPath(new URL('../../agent-src/constants.js', import.meta.url))

interface EnumSchema {
  properties: Record<string, { enum?: string[]; pattern?: string }>
}

function readSchema<T>(file: string): T {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')) as T
}

function loadConstants(): Record<string, unknown> {
  const raw = readFileSync(CONSTANTS_PATH, 'utf8')
  const wrapped = raw + '\n;({ PHASE_ORDER, VALID_REGIONS, VALID_ROLES, VALID_STATUSES });'
  return new Script(wrapped, { filename: 'constants.js' }).runInNewContext({}) as Record<string, unknown>
}

function createSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  for (const file of readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.schema.json'))) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'))
    ajv.addSchema(schema, file)
  }
  const validate = ajv.getSchema('root.schema.json')
  if (!validate) throw new Error('无法编译 root.schema.json')
  return validate
}

function readFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, relativePath), 'utf8'))
}

function cloneFixture(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, relativePath), 'utf8')) as Record<string, unknown>
}

/**
 * 契约测试：
 * - valid fixtures 必须同时通过 JSON Schema 与运行时 validator；
 * - 运行时 validator 拒绝的数据，JSON Schema 也必须拒绝；
 * - 值域错误（如 phase pattern）由 ops CI 负责，运行时 validator 不重复，允许 schema-only 拒绝。
 */
describe('schema / validateRaceData contract', () => {
  const validateSchema = createSchemaValidator()
  const validFixtures = readdirSync(join(FIXTURE_DIR, 'valid'))
  const invalidFixtures = readdirSync(join(FIXTURE_DIR, 'invalid'))

  it('valid fixtures 同时通过 schema 与运行时校验', () => {
    for (const file of validFixtures) {
      const data = readFixture(`valid/${file}`)
      expect(validateSchema(data), `schema should accept valid/${file}`).toBe(true)
      expect(validateRaceData(data).ok, `runtime should accept valid/${file}`).toBe(true)
    }
  })

  it('运行时拒绝的 fixture，schema 也必须拒绝', () => {
    for (const file of invalidFixtures) {
      const data = readFixture(`invalid/${file}`)
      const runtime = validateRaceData(data)
      if (!runtime.ok) {
        expect(validateSchema(data), `schema should reject invalid/${file}`).toBe(false)
      }
    }
  })

  it('runtime 抓住的 shape 错误，schema 也能抓住', () => {
    const baseFixture = 'valid/single-dungeon.json'
    const withoutContent = cloneFixture(baseFixture)
    delete withoutContent.content

    const sevenPlayers = cloneFixture(baseFixture)
    const teams = sevenPlayers.teams as unknown[]
    const firstTeam = teams[0] as Record<string, unknown>
    ;(firstTeam.players as unknown[]).pop()

    const badSponsor = cloneFixture(baseFixture)
    badSponsor.sponsors = [{ name: '缺少 desc' }]

    for (const [label, data] of [
      ['content missing', withoutContent],
      ['players not 8', sevenPlayers],
      ['sponsor missing desc', badSponsor],
    ] as const) {
      expect(validateRaceData(data).ok, `runtime should reject ${label}`).toBe(false)
      expect(validateSchema(data), `schema should reject ${label}`).toBe(false)
    }
  })

  it('schema 值域与 constants.js 一致', () => {
    const constants = loadConstants()
    const metaSchema = readSchema<EnumSchema>('meta.schema.json')
    const teamSchema = readSchema<EnumSchema>('team.schema.json')
    const playerSchema = readSchema<EnumSchema>('player.schema.json')

    expect([...(constants.VALID_STATUSES as string[])].sort()).toEqual(
      [...(metaSchema.properties.status.enum ?? [])].sort()
    )
    expect([...(constants.VALID_REGIONS as string[])].sort()).toEqual(
      [...(teamSchema.properties.region.enum ?? [])].sort()
    )
    expect([...(constants.VALID_ROLES as string[])].sort()).toEqual(
      [...(playerSchema.properties.role.enum ?? [])].sort()
    )

    const phasePattern = teamSchema.properties.phase.pattern
    if (!phasePattern) throw new Error('team.schema.json 缺少 phase pattern')
    const phaseRegex = new RegExp(phasePattern)
    for (const phase of constants.PHASE_ORDER as string[]) {
      expect(phaseRegex.test(phase), `phase ${phase} 不符合 schema pattern`).toBe(true)
    }
  })

  it('SECTIONS 与 sections.schema.json 键一致', () => {
    const sectionsSchema = readSchema<{ required: string[] }>('sections.schema.json')
    expect(SECTIONS.map((section) => section.id)).toEqual(sectionsSchema.required)
  })
})
