import { describe, expect, it } from 'vitest'
import {
  selectCopyrightYear,
  selectFolio,
  selectIsLive,
  selectPhaseView,
  selectRankMedal,
  selectRankingBadge,
  selectRegionView,
  selectSyncLineView,
  selectTimerView,
} from '../selectors'

const multiDungeon = [
  { id: 'M1S', name: '阿罗阿罗岛' },
  { id: 'M2S', name: '新月岛' },
]

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

describe('selectRankMedal', () => {
  it('前三名给奖牌色，其余为空', () => {
    expect(selectRankMedal(1)).toBe('n1')
    expect(selectRankMedal(2)).toBe('n2')
    expect(selectRankMedal(3)).toBe('n3')
    expect(selectRankMedal(4)).toBe('')
  })
})

describe('selectRegionView', () => {
  it('区服转小写 class，空值显示 ?? 且不加色', () => {
    expect(selectRegionView('JP')).toEqual({ label: 'JP', className: 'rg-jp' })
    expect(selectRegionView('')).toEqual({ label: '??', className: '' })
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

describe('selectTimerView', () => {
  const now = new Date(2026, 10, 1, 20, 0, 0).getTime()

  it('已结束优先于开赛时间', () => {
    expect(selectTimerView({ status: 'ended', startTime: new Date(now - 3_600_000).toISOString() }, now)).toEqual({
      kind: 'ended',
      text: '已结束',
    })
  })

  it('未开赛且 24h 内显示秒级倒计时', () => {
    expect(selectTimerView({ status: 'upcoming', startTime: new Date(now + 90_000).toISOString() }, now)).toEqual({
      kind: 'countdown',
      text: '距开赛 00:01:30',
    })
  })

  it('未开赛且超过 24h 显示开赛日期', () => {
    const start = new Date(2026, 10, 5, 20, 0, 0)
    expect(selectTimerView({ status: 'upcoming', startTime: start.toISOString() }, now)).toEqual({
      kind: 'countdown',
      text: '2026-11-05 20:00 开赛',
    })
  })

  it('未开赛但本地时间已过开赛时刻显示等待开赛', () => {
    expect(selectTimerView({ status: 'upcoming', startTime: new Date(now - 5_000).toISOString() }, now)).toEqual({
      kind: 'waiting',
      text: '等待开赛',
    })
  })

  it('开赛时间未知按状态区分文案', () => {
    expect(selectTimerView({ status: 'upcoming', startTime: '-' }, now)).toEqual({
      kind: 'unknown',
      text: '开赛时间待定',
    })
    expect(selectTimerView({ status: 'live', startTime: '-' }, now)).toEqual({
      kind: 'unknown',
      text: '开赛时间未知',
    })
  })

  it('进行中显示已开赛时长', () => {
    expect(selectTimerView({ status: 'live', startTime: new Date(now - 3_723_000).toISOString() }, now)).toEqual({
      kind: 'elapsed',
      text: '+01:02:03',
    })
  })

  it('进行中但开赛时间在未来仍显示倒计时', () => {
    expect(selectTimerView({ status: 'live', startTime: new Date(now + 60_000).toISOString() }, now)).toEqual({
      kind: 'countdown',
      text: '距开赛 00:01:00',
    })
  })
})

describe('selectSyncLineView', () => {
  const now = new Date(2026, 10, 1, 20, 0, 0).getTime()
  const syncedAt = new Date(2026, 10, 1, 21, 3, 12).getTime()
  const futureStart = new Date(now + 3_600_000).toISOString()
  const passedStart = new Date(now - 60_000).toISOString()

  function sync(overrides: Partial<{ refreshing: boolean; lastSyncedAt: number | null; error: string | null }> = {}) {
    return { refreshing: false, lastSyncedAt: null, error: null, ...overrides }
  }

  it('刷新中优先展示同步中并禁用按钮', () => {
    expect(selectSyncLineView({ status: 'live', sync: sync({ refreshing: true }) }, now)).toMatchObject({
      text: '正在同步…',
      actionDisabled: true,
    })
  })

  it('进行中失败与未开赛/已结束失败文案不同', () => {
    expect(selectSyncLineView({ status: 'live', sync: sync({ error: 'HTTP 500' }) }, now)).toMatchObject({
      text: '同步失败，正在重试',
      tone: 'error',
    })
    expect(selectSyncLineView({ status: 'ended', sync: sync({ error: 'HTTP 500' }) }, now)).toMatchObject({
      text: '刷新失败，请稍后重试',
      tone: 'error',
    })
  })

  it('未开赛提示手动刷新', () => {
    expect(selectSyncLineView({ status: 'upcoming', startTime: futureStart, sync: sync() }, now)).toMatchObject({
      text: '未开赛 · 开赛后请点「立即刷新」',
      tone: 'neutral',
      actionDisabled: false,
    })
  })

  it('本地已过开赛时刻仍未开赛时高亮提示', () => {
    expect(selectSyncLineView({ status: 'upcoming', startTime: passedStart, sync: sync() }, now)).toMatchObject({
      text: '开赛时间已到 · 请刷新获取比赛状态',
      tone: 'accent',
    })
  })

  it('开赛时间未知时说明可手动刷新', () => {
    expect(selectSyncLineView({ status: 'upcoming', startTime: '-', sync: sync() }, now)).toMatchObject({
      text: '未开赛 · 开赛时间待定，可手动刷新',
    })
  })

  it('手动刷新后展示最近检查时间', () => {
    expect(
      selectSyncLineView({ status: 'upcoming', startTime: passedStart, sync: sync({ lastSyncedAt: syncedAt }) }, now)
    ).toMatchObject({ text: '未开赛 · 最近检查 21:03:12' })
  })

  it('进行中展示已同步时间；从未成功时提示等待', () => {
    expect(selectSyncLineView({ status: 'live', sync: sync({ lastSyncedAt: syncedAt }) }, now)).toMatchObject({
      text: '已同步 21:03:12',
    })
    expect(selectSyncLineView({ status: 'live', sync: sync() }, now)).toMatchObject({
      text: '等待首次同步',
    })
  })

  it('已结束说明停止自动检查', () => {
    expect(selectSyncLineView({ status: 'ended', sync: sync({ lastSyncedAt: syncedAt }) }, now)).toMatchObject({
      text: '赛事已结束 · 已停止自动检查',
    })
  })
})

describe('selectRankingBadge', () => {
  it('未开赛种子序、已结束最终成绩、进行中无徽标', () => {
    expect(selectRankingBadge('upcoming')).toEqual({ label: '种子序', className: 'seed' })
    expect(selectRankingBadge('ended')).toEqual({ label: '最终成绩', className: 'final' })
    expect(selectRankingBadge('live')).toBeNull()
  })
})
