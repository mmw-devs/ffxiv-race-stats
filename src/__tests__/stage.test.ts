import { describe, expect, it } from 'vitest'
import {
  PHASE_PATTERN_SOURCE,
  STAGE_PATTERN_SOURCE,
  parseStage,
  stageClass,
  stageRank,
} from '../../agent-src/shared/stage.mjs'

describe('stage grammar', () => {
  it('接受 P<正整数> 与 CLEAR', () => {
    expect(parseStage('P1')).toEqual({ kind: 'phase', rank: 1 })
    expect(parseStage('P4')).toEqual({ kind: 'phase', rank: 4 })
    expect(parseStage('P5')).toEqual({ kind: 'phase', rank: 5 })
    expect(parseStage('P99')).toEqual({ kind: 'phase', rank: 99 })
    expect(parseStage('CLEAR')).toEqual({ kind: 'clear', rank: Infinity })
  })

  it('拒绝 P0、前导零、FINAL 和空值', () => {
    for (const value of ['P0', 'P01', 'P', 'FINAL', 'p1', '', null, 1]) {
      expect(parseStage(value)).toBeNull()
    }
  })

  it('排序把 CLEAR 视为最高', () => {
    expect(stageRank('P1')).toBe(1)
    expect(stageRank('P99')).toBe(99)
    expect(stageRank('CLEAR')).toBe(Infinity)
    expect(stageRank('P0')).toBeNull()
  })

  it('CSS class 对 P5+ 使用有限兜底', () => {
    expect(stageClass('P1')).toBe('p1')
    expect(stageClass('P4')).toBe('p4')
    expect(stageClass('P5')).toBe('late')
    expect(stageClass('P99')).toBe('late')
    expect(stageClass('CLEAR')).toBe('clear')
    expect(stageClass('FINAL')).toBe('')
  })

  it('schema pattern 与共享语法一致', () => {
    expect(STAGE_PATTERN_SOURCE).toBe('^(P[1-9][0-9]*|CLEAR)$')
    expect(PHASE_PATTERN_SOURCE).toBe('^([A-Z0-9]+-)?(P[1-9][0-9]*|CLEAR)$')
  })
})
