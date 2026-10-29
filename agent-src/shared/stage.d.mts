export const STAGE_CLEAR: 'CLEAR'
export const STAGE_PATTERN_SOURCE: string
export const PHASE_PATTERN_SOURCE: string

export interface StageInfo {
  kind: 'phase' | 'clear'
  rank: number
}

export function parseStage(value: unknown): StageInfo | null
export function stageRank(value: unknown): number | null
export function stageClass(value: unknown): 'p1' | 'p2' | 'p3' | 'p4' | 'late' | 'clear' | ''
