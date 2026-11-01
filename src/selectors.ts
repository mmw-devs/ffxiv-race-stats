import type { Dungeon, Meta } from '../types/race-data'
import { displayPhase, phaseStage } from './utils/phase'
import { stageClass } from '../agent-src/shared/stage.mjs'

/** LIVE 徽标是否显示。 */
export function selectIsLive(status: Meta['status']): boolean {
  return status === 'live'
}

/** 页面 folio 统一格式：VOL.<edition> · <page>。 */
export function selectFolio(meta: Pick<Meta, 'edition'>, page: string): string {
  return `VOL.${meta.edition ?? ''} · ${page}`
}

/** 页脚版权年份：优先取赛事开赛年份，未知时回退当前年。 */
export function selectCopyrightYear(meta: Pick<Meta, 'startTime'>): string {
  const start = meta.startTime && meta.startTime !== '-' ? Date.parse(meta.startTime) : NaN
  return String(Number.isNaN(start) ? new Date().getFullYear() : new Date(start).getUTCFullYear())
}

export type RankMedal = 'n1' | 'n2' | 'n3' | ''

/** 前三名奖牌三色（金 n1 / 银 n2 / 铜 n3），其余名次无特殊色。 */
export function selectRankMedal(rank: number): RankMedal {
  if (rank === 1) return 'n1'
  if (rank === 2) return 'n2'
  if (rank === 3) return 'n3'
  return ''
}

export interface RegionView {
  label: string
  className: string
}

/** 区服标签文本 + 配色 class；空值显示 "??" 且不加色。 */
export function selectRegionView(region: string): RegionView {
  const key = (region || '').toLowerCase()
  return {
    label: region || '??',
    className: key ? `rg-${key}` : '',
  }
}

export interface PhaseView {
  label: string
  className: string
}

/** 阶段的展示文本 + CSS class，避免组件各自解释 phase。 */
export function selectPhaseView(phase: string, dungeons: readonly Dungeon[]): PhaseView {
  return {
    label: displayPhase(phase, dungeons),
    className: stageClass(phaseStage(phase)),
  }
}
