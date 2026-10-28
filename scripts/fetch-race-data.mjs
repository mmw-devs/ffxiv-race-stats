import { createSchemaValidator, formatSchemaErrors } from './schema-validator.mjs'
import { DATA_SOURCE_URL } from './data-source.mjs'

const ATTEMPTS = 3
const TIMEOUT_MS = 15_000

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
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const raw = await resp.text()
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        throw new Error('响应不是合法 JSON（可能拿到了 HTML 错误页）')
      }

      if (!validate(data)) {
        throw new Error(`数据未通过 schema 校验：${formatSchemaErrors(validate)}`)
      }

      return { raw, data }
    } catch (e) {
      lastErr = e
      if (attempt < ATTEMPTS) {
        console.warn(`[race-data] 第 ${attempt} 次失败：${e.message}，重试…`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error(`拉取真源失败（${ATTEMPTS} 次）：${lastErr?.message ?? lastErr}（来源：${DATA_SOURCE_URL}）`)
}
