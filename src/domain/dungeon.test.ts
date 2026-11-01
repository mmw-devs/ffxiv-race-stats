import { describe, expect, it } from 'vitest'
import {
  filterTeamsByDungeon,
  selectDungeonTabs,
  selectTeamDungeonState,
} from './dungeon'
import type { Dungeon, Team } from '../../types/race-data'

const dungeons: Dungeon[] = [
  { id: 'M1S', name: '零式 1 层' },
  { id: 'M2S', name: '零式 2 层' },
  { id: 'M3S', name: '零式 3 层' },
  { id: 'M4S', name: '零式 4 层' },
]

function team(rank: number, phase: string, bossHP = 50): Team {
  return {
    id: 't' + rank,
    name: '队伍 ' + rank,
    rank,
    bossHP,
    phase,
    region: 'NA',
    players: [] as unknown as Team['players'],
  }
}

describe('selectTeamDungeonState', () => {
  it('多副本按前缀归属', () => {
    expect(selectTeamDungeonState(team(1, 'M2S-P3'), dungeons)).toEqual({
      dungeonId: 'M2S',
      dungeonIndex: 1,
      stage: 'P3',
      isClear: false,
    })
  })

  it('CLEAR 与 P 阶段共用同一归属', () => {
    expect(selectTeamDungeonState(team(2, 'M1S-CLEAR', 0), dungeons)).toMatchObject({
      dungeonIndex: 0,
      stage: 'CLEAR',
      isClear: true,
    })
  })

  it('单副本无前缀阶段归属唯一副本', () => {
    const single: Dungeon[] = [{ id: 'U1S', name: '绝境' }]
    expect(selectTeamDungeonState(team(1, 'P2'), single)).toEqual({
      dungeonId: 'U1S',
      dungeonIndex: 0,
      stage: 'P2',
      isClear: false,
    })
    expect(selectTeamDungeonState(team(1, 'CLEAR', 0), single).isClear).toBe(true)
  })

  it('多副本下无前缀 / 未知副本时无法归属', () => {
    expect(selectTeamDungeonState(team(1, 'P3'), dungeons)).toMatchObject({
      dungeonId: null,
      dungeonIndex: null,
    })
    expect(selectTeamDungeonState(team(1, 'X9S-P1'), dungeons)).toMatchObject({
      dungeonId: null,
      dungeonIndex: null,
    })
  })
})

describe('selectDungeonTabs', () => {
  it('单副本不产生 tab', () => {
    expect(selectDungeonTabs([team(1, 'P1')], [{ id: 'U1S', name: '绝境' }])).toEqual([])
  })

  it('按当前层计数，并区分已通过 / 在打', () => {
    const teams = [
      team(1, 'M2S-P1'),
      team(2, 'M1S-CLEAR', 0),
      team(3, 'M1S-P2'),
      team(4, 'X9S-P1'),
    ]
    const tabs = selectDungeonTabs(teams, dungeons)

    expect(tabs.map((tab) => tab.id)).toEqual(['M1S', 'M2S', 'M3S', 'M4S'])
    expect(tabs[0]).toMatchObject({ count: 2, cleared: 2, inProgress: 1, total: 4 })
    expect(tabs[1]).toMatchObject({ count: 1, cleared: 0, inProgress: 1 })
    expect(tabs[2]).toMatchObject({ count: 0, cleared: 0 })
  })

  it('进入更后面层的队伍计入前面各层的「已通过」', () => {
    const tabs = selectDungeonTabs([team(1, 'M3S-P1')], dungeons)
    expect(tabs.map((tab) => tab.cleared)).toEqual([1, 1, 0, 0])
  })
})

describe('filterTeamsByDungeon', () => {
  const teams = [
    team(1, 'M2S-P1'),
    team(2, 'M1S-CLEAR', 0),
    team(3, 'M1S-P2'),
    team(4, 'X9S-P1'),
  ]

  it('null 返回全部且保留原顺序', () => {
    expect(filterTeamsByDungeon(teams, dungeons, null).map((t) => t.rank)).toEqual([1, 2, 3, 4])
  })

  it('选中某层只返回当前层在该层的队伍（含 CLEAR）', () => {
    expect(filterTeamsByDungeon(teams, dungeons, 'M1S').map((t) => t.rank)).toEqual([2, 3])
    expect(filterTeamsByDungeon(teams, dungeons, 'M2S').map((t) => t.rank)).toEqual([1])
  })

  it('未知副本 id 返回空', () => {
    expect(filterTeamsByDungeon(teams, dungeons, 'M9S')).toEqual([])
  })
})
