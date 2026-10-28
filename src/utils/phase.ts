import type { Dungeon } from '../../types/race-data'

export interface ParsedPhase {
  dungeonId: string
  stage: string
}

/**
 * 解析复合 phase：
 * - 多副本：`<副本id>-<阶段>`（如 M1S-P4、M2S-CLEAR）
 * - 单副本（绝境）：`<阶段>`（如 P4、CLEAR）
 *
 * 没有 "-"、"-" 在开头或结尾时返回 null，由调用方按原样容错显示。
 */
export function parsePhase(phase: string): ParsedPhase | null {
  const dash = phase.indexOf('-')
  if (dash <= 0 || dash === phase.length - 1) return null
  return {
    dungeonId: phase.slice(0, dash),
    stage: phase.slice(dash + 1),
  }
}

/** 只取阶段（P4 / CLEAR），用于 CSS class 与单副本展示。 */
export function phaseStage(phase: string): string {
  return parsePhase(phase)?.stage ?? phase
}

/**
 * 阶段展示文本：
 * - 单副本：只显示阶段
 * - 多副本：显示 "副本id · 阶段"
 * - 旧数据 / 非法格式：原样显示
 */
export function displayPhase(phase: string, dungeons: readonly Dungeon[] = []): string {
  const parsed = parsePhase(phase)
  if (!parsed) return phase
  return dungeons.length <= 1 ? parsed.stage : `${parsed.dungeonId} · ${parsed.stage}`
}
