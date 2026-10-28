import { validateRaceData } from './validateRaceData'
import type { RaceData } from '../types'

export type ParseRaceDataResult =
  | { ok: true; data: RaceData }
  | { ok: false; errors: string[] }

/**
 * data.json 的唯一解析入口。
 *
 * validateRaceData 负责 shape 校验；校验通过后在这里做唯一一次 `unknown → RaceData`
 * 的类型收窄。组件不再各自 `as`，也不再构造空对象。
 */
export function parseRaceData(data: unknown): ParseRaceDataResult {
  const result = validateRaceData(data)
  if (!result.ok) return { ok: false, errors: result.errors }
  return { ok: true, data: data as RaceData }
}
