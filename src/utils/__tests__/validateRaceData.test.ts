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
        name: '测试队伍',
        rank: 1,
        bossHP: 50,
        phase: 'P1',
        region: 'NA',
        players: Array.from({ length: 8 }, () => ({
          job: 'PLD',
          role: 'tank',
          stream: '#',
          streaming: false,
        })),
      },
    ],
    content: makeContent(),
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

  it('content 缺失时失败', () => {
    const data = makeValidData()
    delete data.content

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('content 应存在')
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

  it('拒绝协议相对 URL', () => {
    const data = makeValidData()
    const content = makeContent()
    ;(content.hero as { primaryCta: { href: string } }).primaryCta.href = '//evil.example/x'
    ;(content.media as Record<string, unknown>).heroVideo = '//evil.example/x'
    data.content = content

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('content.hero.primaryCta.href 应为锚点、站内路径或 http(s) URL')
    expect(result.errors).toContain('content.media.heroVideo 应为站内路径或 http(s) URL')
  })

  it('sponsors 缺 desc 时失败', () => {
    const data = makeValidData()
    data.sponsors = [{ name: '赞助商' }]

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('sponsors[0].desc 应为 string')
  })

  it('teams[0].players 恰好 8 项', () => {
    const data = makeValidData()
    const teams = data.teams as Array<{ players: unknown[] }>
    teams[0].players = teams[0].players.slice(0, 7)

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('teams[0].players 应为恰好 8 项的数组')
  })

  it('team.name 缺失时失败', () => {
    const data = makeValidData()
    const teams = data.teams as Array<Record<string, unknown>>
    delete teams[0].name

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('teams[0].name 应为非空 string')
  })

  it('streaming=true 但 stream 为 # 时失败', () => {
    const data = makeValidData()
    const teams = data.teams as Array<{ players: Array<Record<string, unknown>> }>
    teams[0].players[0].streaming = true
    teams[0].players[0].stream = '#'

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('teams[0].players[0].streaming=true 时 stream 不能为 #')
  })

  it('非 http(s) stream 失败', () => {
    const data = makeValidData()
    const teams = data.teams as Array<{ players: Array<Record<string, unknown>> }>
    teams[0].players[0].stream = 'javascript:alert(1)'

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('teams[0].players[0].stream 应为 # 或 http(s) URL')
  })

  it('broadcaster.url 只允许 # 或 http(s)', () => {
    const data = makeValidData()
    data.broadcasters = [{ id: 'b1', name: '转播台', platform: 'bilibili', url: 'javascript:alert(1)', note: '' }]

    const result = validateRaceData(data)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('broadcasters[0].url 应为 # 或 http(s) URL')
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
