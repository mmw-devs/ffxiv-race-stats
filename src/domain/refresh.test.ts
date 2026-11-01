import { describe, expect, it } from 'vitest'
import {
  LIVE_REFRESH_INTERVAL_MS,
  MAX_REFRESH_INTERVAL_MS,
  autoRefreshDelay,
  isRefreshStale,
} from './refresh'

describe('autoRefreshDelay', () => {
  it('进行中基础间隔 60 秒', () => {
    expect(autoRefreshDelay('live', 0)).toBe(LIVE_REFRESH_INTERVAL_MS)
  })

  it('未开赛 / 已结束不自动检查', () => {
    expect(autoRefreshDelay('upcoming', 0)).toBeNull()
    expect(autoRefreshDelay('ended', 0)).toBeNull()
    expect(autoRefreshDelay('upcoming', 3)).toBeNull()
  })

  it('失败后退避并封顶 5 分钟', () => {
    expect(autoRefreshDelay('live', 1)).toBe(120_000)
    expect(autoRefreshDelay('live', 2)).toBe(240_000)
    expect(autoRefreshDelay('live', 3)).toBe(MAX_REFRESH_INTERVAL_MS)
    expect(autoRefreshDelay('live', 99)).toBe(MAX_REFRESH_INTERVAL_MS)
  })

  it('非法失败次数按 0 处理', () => {
    expect(autoRefreshDelay('live', -1)).toBe(LIVE_REFRESH_INTERVAL_MS)
    expect(autoRefreshDelay('live', Number.NaN)).toBe(LIVE_REFRESH_INTERVAL_MS)
  })
})

describe('isRefreshStale', () => {
  const now = 1_000_000

  it('只有进行中才可能过期', () => {
    expect(isRefreshStale(null, now, 'upcoming')).toBe(false)
    expect(isRefreshStale(null, now, 'ended')).toBe(false)
    expect(isRefreshStale(null, now, 'live')).toBe(true)
  })

  it('距上次成功检查超过基础间隔才算过期', () => {
    expect(isRefreshStale(now - LIVE_REFRESH_INTERVAL_MS + 1, now, 'live')).toBe(false)
    expect(isRefreshStale(now - LIVE_REFRESH_INTERVAL_MS, now, 'live')).toBe(true)
    expect(isRefreshStale(now - 10 * 60_000, now, 'live')).toBe(true)
  })
})
