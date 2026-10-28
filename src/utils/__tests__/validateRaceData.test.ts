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

function makeContent(): Record<string, unknown> {
  return {
    hero: {
      kicker: 'FINALFANTASY · 2026',
      lead: '导语',
      primaryCta: { label: '立即报名', href: '#register' },
      secondaryCta: { label: '查看排名', href: '#ranking' },
    },
    rules: {
      title: '赛事规则',
      kicker: 'RACE REGULATION',
      items: ['规则一'],
    },
    seo: {
      title: '赛事标题',
      description: '赛事描述',
    },
    media: {
      heroVideo: '/hero.mp4',
      heroPoster: '/poster.jpg',
    },
    sections: {
      ranking: { kicker: 'RACE REPORT', title: '实时排名' },
      news: { kicker: 'LIVE TIMELINE', title: '速报时间线' },
      sponsors: { kicker: 'SPONSORS', title: '赞助公示' },
      guides: { kicker: 'GUIDES', title: '副本攻略' },
    },
  }
}

describe('validateRaceData', () => {
  it('合法数据通过校验', () => {
    expect(validateRaceData(makeValidData())).toEqual({ ok: true, errors: [] })
  })

  it('content 合法时通过（迁移期可选，出现时校验）', () => {
    const data = makeValidData()
    data.content = makeContent()
    expect(validateRaceData(data)).toEqual({ ok: true, errors: [] })
  })

  it('content.hero.lead 缺失时失败', () => {
    const data = makeValidData()
    const content = makeContent()
    ;(content.hero as Record<string, unknown>).lead = undefined
    data.content = content

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('content.hero.lead 应为 string')
  })

  it('content.rules.items 为空时失败', () => {
    const data = makeValidData()
    const content = makeContent()
    ;(content.rules as Record<string, unknown>).items = []
    data.content = content

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('content.rules.items 至少需要 1 项')
  })

  it('content.media 不是站内路径 / URL 时失败', () => {
    const data = makeValidData()
    const content = makeContent()
    ;(content.media as Record<string, unknown>).heroVideo = 'hero.mp4'
    data.content = content

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('content.media.heroVideo 应为站内路径或 http(s) URL')
  })

  it('sponsors 缺 desc 时失败', () => {
    const data = makeValidData()
    data.sponsors = [{ name: '赞助商' }]

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('sponsors[0].desc 应为 string')
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
