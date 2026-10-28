import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRaceData } from '../parseRaceData'

const FIXTURE_DIR = fileURLToPath(new URL('../../../agent-src/scripts/__tests__/fixtures/', import.meta.url))

function readFixture(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, relativePath), 'utf8')) as Record<string, unknown>
}

describe('parseRaceData', () => {
  it('valid fixture 返回 typed data', () => {
    const result = parseRaceData(readFixture('valid/single-dungeon.json'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.meta.eventName).toBeTypeOf('string')
      expect(result.data.content.hero.lead).toBeTypeOf('string')
      expect(result.data.teams.length).toBeGreaterThan(0)
    }
  })

  it('shape 错误返回 errors，而不是抛异常', () => {
    const data = readFixture('valid/single-dungeon.json')
    delete data.content
    const result = parseRaceData(data)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('content 应存在')
  })
})
