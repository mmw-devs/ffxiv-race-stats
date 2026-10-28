// 阶段/进度语法：跨 dev 前端与 ops validator 的唯一实现。
//
// 阶段不是有限枚举：每届赛事都可能是 P1..Pn + CLEAR。
// 因此只约束语法，排序用数值 rank，CLEAR 视为正无穷。
export const STAGE_CLEAR = 'CLEAR'

export const STAGE_PATTERN_SOURCE = '^(P[1-9][0-9]*|CLEAR)$'
export const PHASE_PATTERN_SOURCE = '^([A-Z0-9]+-)?(P[1-9][0-9]*|CLEAR)$'

const STAGE_PATTERN = new RegExp(STAGE_PATTERN_SOURCE)

/**
 * 解析单个阶段（不含副本前缀）。
 * @returns {{ kind: 'phase' | 'clear', rank: number } | null}
 */
export function parseStage(value) {
  if (typeof value !== 'string' || !STAGE_PATTERN.test(value)) return null
  if (value === STAGE_CLEAR) return { kind: 'clear', rank: Number.POSITIVE_INFINITY }
  return { kind: 'phase', rank: Number(value.slice(1)) }
}

/** 阶段排序值：P1=1，P99=99，CLEAR=Infinity；非法返回 null。 */
export function stageRank(value) {
  return parseStage(value)?.rank ?? null
}

/**
 * 阶段对应的 CSS class。
 * 前 4 阶段保留现有颜色；P5+ 统一归入 late，避免无限 class。
 */
export function stageClass(value) {
  const parsed = parseStage(value)
  if (!parsed) return ''
  if (parsed.kind === 'clear') return 'clear'
  return parsed.rank <= 4 ? `p${parsed.rank}` : 'late'
}
