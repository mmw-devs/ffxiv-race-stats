import { describe, expect, it } from 'vitest'
import { selectRankingMode } from './status'

describe('selectRankingMode', () => {
  it('未开赛为种子序，进行中为实时，已结束为最终', () => {
    expect(selectRankingMode('upcoming')).toBe('seed')
    expect(selectRankingMode('live')).toBe('live')
    expect(selectRankingMode('ended')).toBe('final')
  })
})
