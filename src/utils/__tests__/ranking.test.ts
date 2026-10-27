import { describe, expect, it } from 'vitest'
import { compareTeamsByRank, sortTeamsByRank } from '../ranking'
import type { Team } from '../../../types/race-data'

function makeTeam(id: string, rank: number): Team {
  return {
    id,
    rank,
    bossHP: 50,
    phase: 'P1',
    region: 'NA',
    isLive: false,
    players: Array.from({ length: 8 }, () => ({
      job: 'PLD',
      role: 'tank',
      stream: '',
      streaming: false,
    })) as unknown as Team['players'],
  }
}

describe('sortTeamsByRank', () => {
  it('按 rank 升序排列，且不修改入参', () => {
    const input = [makeTeam('c', 3), makeTeam('a', 1), makeTeam('b', 2)]
    const output = sortTeamsByRank(input)

    expect(output.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(input.map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('同 rank 时按 id 稳定排序', () => {
    const output = sortTeamsByRank([makeTeam('b', 1), makeTeam('a', 1)])
    expect(output.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('compareTeamsByRank', () => {
  it('rank 相同时用 id 兜底', () => {
    expect(compareTeamsByRank(makeTeam('b', 1), makeTeam('a', 1))).toBeGreaterThan(0)
    expect(compareTeamsByRank(makeTeam('a', 1), makeTeam('b', 1))).toBeLessThan(0)
  })
})
