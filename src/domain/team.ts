import type { Team } from '../../types/race-data'
import { parsePhase } from '../utils/phase'

/** Team 的进度值对象：phase 与 bossHP 属于同一个聚合状态。 */
export interface TeamProgress {
  phase: string
  bossHP: number
  /** 多副本时为副本 id，单副本/非法格式为 null。 */
  dungeonId: string | null
  /** 仅阶段部分（P<n> / CLEAR / 原样）。 */
  stage: string
}

export function selectTeamProgress(team: Pick<Team, 'phase' | 'bossHP'>): TeamProgress {
  const parsed = parsePhase(team.phase)
  return {
    phase: team.phase,
    bossHP: team.bossHP,
    dungeonId: parsed?.dungeonId ?? null,
    stage: parsed?.stage ?? team.phase,
  }
}

/** Team 的 LIVE 状态由 Player.streaming 派生，不再存 data.json。 */
export function selectTeamIsLive(team: Pick<Team, 'players'>): boolean {
  return team.players.some((player) => player.streaming)
}
