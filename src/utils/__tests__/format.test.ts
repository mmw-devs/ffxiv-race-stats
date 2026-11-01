import { describe, expect, it } from 'vitest'
import { formatBossHP, pad2 } from '../format'

describe('pad2', () => {
  it('补零到至少两位', () => {
    expect(pad2(1)).toBe('01')
    expect(pad2(100)).toBe('100')
  })
})

describe('formatBossHP', () => {
  it('保留 1 位小数并带百分号', () => {
    expect(formatBossHP(42)).toBe('42.0%')
    expect(formatBossHP(42.55)).toBe('42.5%')
    expect(formatBossHP(0)).toBe('0.0%')
  })
})
