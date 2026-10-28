import { describe, expect, it } from 'vitest'
import { formatElapsed, formatLocalDate, formatLocalDateTime, formatNewsTime, formatStartLabel } from '../time'

const now = new Date(2026, 9, 28, 12, 0, 0).getTime()

describe('formatNewsTime', () => {
  it('1 分钟内显示「刚刚」', () => {
    expect(formatNewsTime(new Date(now - 30_000).toISOString(), now)).toBe('刚刚')
  })

  it('1 小时内显示分钟', () => {
    expect(formatNewsTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 分钟前')
  })

  it('24 小时内显示小时', () => {
    expect(formatNewsTime(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe('2 小时前')
  })

  it('超过 24 小时显示本地绝对时间', () => {
    const d = new Date(2026, 9, 26, 8, 5)
    expect(formatNewsTime(d.toISOString(), now)).toBe('2026-10-26 08:05')
  })

  it('未来时间回退到本地绝对时间', () => {
    expect(formatNewsTime(new Date(now + 60_000).toISOString(), now)).toBe('2026-10-28 12:01')
  })

  it('非法值原样返回', () => {
    expect(formatNewsTime('-', now)).toBe('-')
    expect(formatNewsTime('not-a-date', now)).toBe('not-a-date')
  })
})

describe('formatStartLabel', () => {
  it('按访客本地时区显示日期', () => {
    const d = new Date(2026, 9, 28, 9, 30)
    expect(formatStartLabel(d.toISOString())).toBe('2026-10-28 起')
  })

  it('占位符 / 非法 / 空值返回空串', () => {
    expect(formatStartLabel('-')).toBe('')
    expect(formatStartLabel('')).toBe('')
    expect(formatStartLabel('not-a-date')).toBe('')
  })
})

describe('formatElapsed', () => {
  it('格式化为 +HH:MM:SS', () => {
    expect(formatElapsed(3_723_000)).toBe('+01:02:03')
  })

  it('负数按 0 处理', () => {
    expect(formatElapsed(-1_000)).toBe('+00:00:00')
  })
})

describe('本地时间格式化', () => {
  it('日期与时间补零', () => {
    const d = new Date(2026, 0, 2, 3, 4)
    expect(formatLocalDate(d)).toBe('2026-01-02')
    expect(formatLocalDateTime(d)).toBe('2026-01-02 03:04')
  })
})
