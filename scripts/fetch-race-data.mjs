import { createSchemaValidator, formatSchemaErrors } from './schema-validator.mjs'
import { DATA_SOURCE_URL } from './data-source.mjs'

const ATTEMPTS = 3
const TIMEOUT_MS = 15_000

/**
 * 取数错误分类：
 * - transport：网络 / HTTP / 超时，可用于 fallback head
 * - parse：拿到了非 JSON
 * - schema：数据非法，必须阻断
 */
export class RaceDataFetchError extends Error {
  constructor(message, kind) {
    super(message)
    this.name = 'RaceDataFetchError'
    this.kind = kind
  }
}

function asFetchError(error) {
  if (error instanceof RaceDataFetchError) return error
  return new RaceDataFetchError(error?.message ?? String(error), 'transport')
}

/**
 * 从真源拉取 data.json，并用完整 schema 校验。
 * 返回原始文本（用于落盘）与解析后的对象。
 */
export async function fetchRaceData() {
  const validate = createSchemaValidator()
  let lastErr

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const resp = await fetch(DATA_SOURCE_URL, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!resp.ok) throw new RaceDataFetchError(`HTTP ${resp.status}`, 'transport')

      const raw = await resp.text()
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        throw new RaceDataFetchError('响应不是合法 JSON（可能拿到了 HTML 错误页）', 'parse')
      }

      if (!validate(data)) {
        throw new RaceDataFetchError(`数据未通过 schema 校验：${formatSchemaErrors(validate)}`, 'schema')
      }

      return { raw, data }
    } catch (e) {
      lastErr = asFetchError(e)
      if (attempt < ATTEMPTS) {
        console.warn(`[race-data] 第 ${attempt} 次失败：${lastErr.message}，重试…`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new RaceDataFetchError(
    `拉取真源失败（${ATTEMPTS} 次）：${lastErr?.message ?? lastErr}（来源：${DATA_SOURCE_URL}）`,
    lastErr?.kind ?? 'transport'
  )
}
