import { describe, expect, it } from 'vitest'
import { validateRaceData } from '../validateRaceData'

function makeValidData(): Record<string, unknown> {
  return {
    meta: {
      eventName: '测试赛事',
      status: 'live',
      dungeons: [{ id: 'M1S', name: '阿罗阿罗岛' }],
    },
    teams: [
      {
        id: 't1',
        rank: 1,
        bossHP: 50,
        phase: 'P1',
        region: 'NA',
        isLive: false,
        players: Array.from({ length: 8 }, () => ({
          job: 'PLD',
          role: 'tank',
          stream: '',
          streaming: false,
        })),
      },
    ],
    news: [],
    broadcasters: [],
    notices: [],
    sponsors: [],
  }
}

describe('validateRaceData', () => {
  it('合法数据通过校验', () => {
    expect(validateRaceData(makeValidData())).toEqual({ ok: true, errors: [] })
  })

  it('players 不是恰好 8 项时失败', () => {
    const data = makeValidData()
    const teams = data.teams as Array<{ players: unknown[] }>
    teams[0].players = teams[0].players.slice(0, 7)

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('teams[0].players 应为恰好 8 项的数组')
  })

  it('meta.dungeons 为空数组时失败', () => {
    const data = makeValidData()
    ;(data.meta as { dungeons: unknown[] }).dungeons = []

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('meta.dungeons 至少需要 1 项')
  })

  it('顶层不是对象时直接返回错误', () => {
    expect(validateRaceData(null)).toEqual({ ok: false, errors: ['data 应为对象'] })
  })
})
