import { describe, expect, it } from 'vitest'
import { selectCopyrightYear, selectCoverage, selectFolio, selectIsLive, selectPhaseView } from '../selectors'
import type { Team } from '../../types/race-data'

function makeTeam(id: string, streaming: boolean[]): Team {
  return {
    id,
    rank: 1,
    bossHP: 50,
    phase: 'P1',
    region: 'NA',
    isLive: false,
    players: streaming.map((value) => ({
      job: 'PLD',
      role: 'tank',
      stream: '',
      streaming: value,
    })) as unknown as Team['players'],
  }
}

const multiDungeon = [
  { id: 'M1S', name: '阿罗阿罗岛' },
  { id: 'M2S', name: '新月岛' },
]

describe('selectCoverage', () => {
  it('汇总选手数、直播选手数与有直播队伍数', () => {
    const teams = [makeTeam('t1', [true, false, ...Array(6).fill(false)]), makeTeam('t2', Array(8).fill(false))]
    expect(selectCoverage(teams)).toEqual({
      totalPlayers: 16,
      streamingPlayers: 1,
      teamsWithCoverage: 1,
    })
  })
})

describe('selectIsLive', () => {
  it('只在 live 状态返回 true', () => {
    expect(selectIsLive('live')).toBe(true)
    expect(selectIsLive('upcoming')).toBe(false)
    expect(selectIsLive('ended')).toBe(false)
  })
})

describe('selectFolio', () => {
  it('统一 VOL / page 格式', () => {
    expect(selectFolio({ edition: '03' }, 'P.01')).toBe('VOL.03 · P.01')
    expect(selectFolio({}, 'P.00')).toBe('VOL. · P.00')
  })
})

describe('selectCopyrightYear', () => {
  it('优先取开赛年份', () => {
    expect(selectCopyrightYear({ startTime: '2026-10-05T10:00:00Z' })).toBe('2026')
  })

  it('跨年边界使用 UTC 年份', () => {
    expect(selectCopyrightYear({ startTime: '2026-12-31T23:00:00Z' })).toBe('2026')
  })

  it('未知开赛时间回退当前年', () => {
    expect(selectCopyrightYear({ startTime: '-' })).toBe(String(new Date().getFullYear()))
    expect(selectCopyrightYear({})).toBe(String(new Date().getFullYear()))
  })
})

describe('selectPhaseView', () => {
  it('多副本显示副本前缀，class 只取 stage', () => {
    expect(selectPhaseView('M1S-P4', multiDungeon)).toEqual({
      label: 'M1S · P4',
      className: 'p4',
    })
    expect(selectPhaseView('M2S-CLEAR', multiDungeon)).toEqual({
      label: 'M2S · CLEAR',
      className: 'clear',
    })
  })

  it('单副本只显示阶段', () => {
    expect(selectPhaseView('P4', [multiDungeon[0]])).toEqual({ label: 'P4', className: 'p4' })
  })

  it('P5+ 使用 late class，非法阶段不产生 class', () => {
    expect(selectPhaseView('M1S-P5', multiDungeon)).toEqual({ label: 'M1S · P5', className: 'late' })
    expect(selectPhaseView('M1S-P99', multiDungeon)).toEqual({ label: 'M1S · P99', className: 'late' })
    expect(selectPhaseView('M1S-FINAL', multiDungeon)).toEqual({ label: 'M1S · FINAL', className: '' })
  })
})
