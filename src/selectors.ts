import type { Dungeon, Meta, Team } from '../types/race-data'
import type { Coverage } from './types'
import { displayPhase, phaseStage } from './utils/phase'

/** 直播覆盖统计：由 teams 派生，不存 data.json。 */
export function selectCoverage(teams: readonly Team[]): Coverage {
  let totalPlayers = 0
  let streamingPlayers = 0
  let teamsWithCoverage = 0

  for (const team of teams) {
    let hasStream = false
    for (const player of team.players) {
      totalPlayers++
      if (player.streaming) {
        streamingPlayers++
        hasStream = true
      }
    }
    if (hasStream) teamsWithCoverage++
  }

  return { totalPlayers, streamingPlayers, teamsWithCoverage }
}

/** LIVE 徽标是否显示。 */
export function selectIsLive(status: Meta['status']): boolean {
  return status === 'live'
}

/** 页面 folio 统一格式：VOL.<edition> · <page>。 */
export function selectFolio(meta: Pick<Meta, 'edition'>, page: string): string {
  return `VOL.${meta.edition ?? ''} · ${page}`
}

export interface PhaseView {
  label: string
  className: string
}

/** 阶段的展示文本 + CSS class，避免组件各自解释 phase。 */
export function selectPhaseView(phase: string, dungeons: readonly Dungeon[]): PhaseView {
  return {
    label: displayPhase(phase, dungeons),
    className: phaseStage(phase).toLowerCase(),
  }
}
