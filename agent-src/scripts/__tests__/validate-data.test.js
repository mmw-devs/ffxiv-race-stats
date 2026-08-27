// validate-data.test.js — data.json 校验脚本单元测试
// 跑 validate-data.js 作为子进程，断言 exit code
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VALIDATE_SCRIPT = path.resolve(__dirname, '..', 'validate-data.js')
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures')

function runValidator(fixturePath) {
  return spawnSync(process.execPath, [VALIDATE_SCRIPT, fixturePath], {
    encoding: 'utf-8',
    timeout: 15000,
  })
}

describe('validate-data.js — 合法 fixtures', () => {
  const validFixtures = [
    'valid/single-dungeon.json',
    'valid/multi-dungeon.json',
    'valid/ended-all-clear.json',
    'valid/upcoming-first-dungeon.json',
  ]

  for (const fixture of validFixtures) {
    it(`${fixture} 应该通过校验`, () => {
      const result = runValidator(path.join(FIXTURES_DIR, fixture))
      expect(result.status, `exit=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0)
    })
  }
})

describe('validate-data.js — 非法 fixtures', () => {
  const cases = [
    {
      file: 'invalid/phase-unknown-dungeon.json',
      desc: 'phase 引用未声明的副本',
      expectErrorContains: '不在 meta.dungeons',
    },
    {
      file: 'invalid/phase-format-lowercase.json',
      desc: 'phase 格式小写非法（被分解为副本 id "m1s" 不在 dungeons[] 中）',
      expectErrorContains: '副本 id "m1s" 不在',
    },
    {
      file: 'invalid/dungeon-order-violation.json',
      desc: '跨副本顺序违反（M2S 出现但 M1S 还有 P3）',
      expectErrorContains: '副本顺序违反',
    },
    {
      file: 'invalid/ended-with-non-clear.json',
      desc: 'status=ended 但 phase 非 lastDungeon-CLEAR',
      expectErrorContains: 'status="ended"',
    },
    {
      file: 'invalid/duplicate-dungeon-id.json',
      desc: '副本 id 重复',
      expectErrorContains: '重复 id',
    },
  ]

  for (const { file, desc, expectErrorContains } of cases) {
    it(`${file} (${desc}) 应该 fail CI`, () => {
      const result = runValidator(path.join(FIXTURES_DIR, file))
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toContain(expectErrorContains)
    })
  }
})