import { describe, expect, it } from 'vitest'
import { selectCoverage } from './coverage'
import type { Team } from '../../types/race-data'

function makeTeam(id: string, streaming: boolean[]): Team {
  return {
    id,
    name: `队伍 ${id}`,
    rank: 1,
    bossHP: 50,
    phase: 'P1',
    region: 'NA',
    players: streaming.map((value) => ({
      job: 'PLD',
      role: 'tank',
      stream: '#',
      streaming: value,
    })) as unknown as Team['players'],
  }
}

describe('selectCoverage', () => {
  it('汇总选手数、直播选手数与有直播队伍数', () => {
    const teams = [
      makeTeam('t1', [true, false, ...Array(6).fill(false)]),
      makeTeam('t2', Array(8).fill(false)),
    ]
    expect(selectCoverage(teams)).toEqual({
      totalPlayers: 16,
      streamingPlayers: 1,
      teamsWithCoverage: 1,
    })
  })
})
