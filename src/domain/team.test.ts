import { describe, expect, it } from 'vitest'
import { selectTeamIsLive, selectTeamProgress } from '../domain/team'
import type { Team } from '../../types/race-data'

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: 't1',
    name: '测试队伍',
    rank: 1,
    bossHP: 42.5,
    phase: 'M1S-P4',
    region: 'NA',
    players: Array.from({ length: 8 }, () => ({
      job: 'PLD',
      role: 'tank',
      stream: '#',
      streaming: false,
    })) as unknown as Team['players'],
    ...overrides,
  }
}

describe('selectTeamProgress', () => {
  it('把 phase / bossHP / 副本 / 阶段收成一个值对象', () => {
    expect(selectTeamProgress(team())).toEqual({
      phase: 'M1S-P4',
      bossHP: 42.5,
      dungeonId: 'M1S',
      stage: 'P4',
    })
  })

  it('单副本无前缀时 dungeonId 为 null', () => {
    expect(selectTeamProgress(team({ phase: 'P2' }))).toMatchObject({
      dungeonId: null,
      stage: 'P2',
    })
  })
})

describe('selectTeamIsLive', () => {
  it('由任意 player.streaming 派生', () => {
    const players = team().players.map((p, i) => ({ ...p, streaming: i === 3 }))
    expect(selectTeamIsLive(team({ players: players as Team['players'] }))).toBe(true)
    expect(selectTeamIsLive(team())).toBe(false)
  })
})
