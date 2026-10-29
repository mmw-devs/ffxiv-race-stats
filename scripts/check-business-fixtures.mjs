#!/usr/bin/env node
// 用 ops 的真实 validator 跑全部 fixtures。
//
// 为什么不是 Vitest：这些 fixture 属于 agent-src 的业务规则测试，根目录的
// vitest.config 只收 src/**；把 validator 当黑盒跑 exit code，能同时覆盖
// schema + 值域 + 业务规则，且不把 ops 代码打进浏览器测试 bundle。

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VALIDATOR = join(ROOT, 'agent-src', 'scripts', 'validate-data.ts')
const FIXTURES = join(ROOT, 'agent-src', 'scripts', '__tests__', 'fixtures')

function runFixture(file) {
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', VALIDATOR, file], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: 'pipe',
    })
    return { ok: true, status: 0 }
  } catch (error) {
    return {
      ok: false,
      status: error.status ?? 1,
      stderr: String(error.stderr ?? ''),
    }
  }
}

let validCount = 0
let invalidCount = 0
const failures = []

for (const file of readdirSync(join(FIXTURES, 'valid')).sort()) {
  const result = runFixture(join(FIXTURES, 'valid', file))
  if (!result.ok) failures.push(`valid/${file} 应通过，实际 exit ${result.status}\n${result.stderr}`)
  validCount++
}

for (const file of readdirSync(join(FIXTURES, 'invalid')).sort()) {
  const result = runFixture(join(FIXTURES, 'invalid', file))
  if (result.ok) failures.push(`invalid/${file} 应失败，但 exit 0`)
  invalidCount++
}

if (failures.length > 0) {
  console.error(`[business-fixtures] ${failures.length} 个 fixture 结果不符合预期：`)
  for (const failure of failures) console.error(`\n- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`[business-fixtures] ${validCount} valid / ${invalidCount} invalid 全部符合预期`)
}
