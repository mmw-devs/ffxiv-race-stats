import type { Player, Team } from '../../types/race-data'
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

/**
 * 选手是否有可用的在播视角：标记在播且链接不是占位符 "#"。
 *
 * 榜单行、覆盖统计、详情弹窗都从这里判断，避免各自写
 * `streaming && stream !== '#'`。
 */
export function isPlayerLive(player: Pick<Player, 'streaming' | 'stream'>): boolean {
  return player.streaming && player.stream !== '#'
}

/** Team 的 LIVE 状态由 Player 派生，不再存 data.json。 */
export function selectTeamIsLive(team: Pick<Team, 'players'>): boolean {
  return team.players.some(isPlayerLive)
}
