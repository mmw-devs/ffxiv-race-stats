import { describe, expect, it } from 'vitest'
import { selectLiveStreams, selectTeamRoster } from './roster'
import type { Player, Team } from '../../types/race-data'

function player(job: string, role: string, streaming = false): Player {
  return {
    job,
    role: role as Player['role'],
    stream: streaming ? 'https://www.twitch.tv/' + job.toLowerCase() : '#',
    streaming,
  }
}

describe('selectTeamRoster', () => {
  it('按 坦克 → 治疗 → 输出 分组，组内保持原顺序', () => {
    const players = [
      player('PLD', 'tank'),
      player('WAR', 'tank'),
      player('WHM', 'healer'),
      player('SCH', 'healer'),
      player('MNK', 'dps'),
      player('DRG', 'dps'),
      player('NIN', 'dps'),
      player('BRD', 'dps'),
    ]
    expect(selectTeamRoster(players).map((group) => [group.role, group.players.map((p) => p.job)])).toEqual([
      ['tank', ['PLD', 'WAR']],
      ['healer', ['WHM', 'SCH']],
      ['dps', ['MNK', 'DRG', 'NIN', 'BRD']],
    ])
  })

  it('未知 role 归入「其他」，不丢人', () => {
    const groups = selectTeamRoster([player('PLD', 'tank'), player('???', 'unknown')])
    expect(groups.map((group) => group.role)).toEqual(['tank', 'other'])
    expect(groups[1]?.players).toHaveLength(1)
  })

  it('空名册返回空数组', () => {
    expect(selectTeamRoster([])).toEqual([])
  })
})

describe('selectLiveStreams', () => {
  it('只返回可打开的视角', () => {
    const team = {
      players: [player('PLD', 'tank', true), player('WAR', 'tank'), player('WHM', 'healer', true)],
    } as unknown as Pick<Team, 'players'>

    expect(selectLiveStreams(team)).toEqual([
      { job: 'PLD', role: 'tank', url: 'https://www.twitch.tv/pld' },
      { job: 'WHM', role: 'healer', url: 'https://www.twitch.tv/whm' },
    ])
  })

  it('streaming=true 但链接为 # 时不产生入口', () => {
    const team = {
      players: [{ job: 'PLD', role: 'tank', stream: '#', streaming: true }],
    } as unknown as Pick<Team, 'players'>

    expect(selectLiveStreams(team)).toEqual([])
  })
})
