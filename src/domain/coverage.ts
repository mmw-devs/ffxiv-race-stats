import type { Coverage } from '../types'
import type { Team } from '../../types/race-data'
import { selectTeamIsLive } from './team'

/**
 * 直播覆盖读模型：只从 Team.players 派生，不存 data.json。
 * - streamingPlayers：所有 players[].streaming
 * - teamsWithCoverage：Team 聚合的派生 isLive
 */
export function selectCoverage(teams: readonly Team[]): Coverage {
  let totalPlayers = 0
  let streamingPlayers = 0
  let teamsWithCoverage = 0

  for (const team of teams) {
    for (const player of team.players) {
      totalPlayers++
      if (player.streaming) streamingPlayers++
    }
    if (selectTeamIsLive(team)) teamsWithCoverage++
  }

  return { totalPlayers, streamingPlayers, teamsWithCoverage }
}
