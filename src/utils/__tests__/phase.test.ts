import { describe, expect, it } from 'vitest'
import { displayPhase, parsePhase, phaseStage } from '../phase'
import type { Dungeon } from '../../../types/race-data'

const multi: Dungeon[] = [
  { id: 'M1S', name: '阿罗阿罗岛' },
  { id: 'M2S', name: '新月岛' },
]
const single: Dungeon[] = [{ id: 'UCOB', name: '巴哈姆特绝境战' }]

describe('parsePhase', () => {
  it('解析多副本复合阶段', () => {
    expect(parsePhase('M1S-P4')).toEqual({ dungeonId: 'M1S', stage: 'P4' })
    expect(parsePhase('M2S-CLEAR')).toEqual({ dungeonId: 'M2S', stage: 'CLEAR' })
  })

  it('单副本/非法格式返回 null', () => {
    expect(parsePhase('P4')).toBeNull()
    expect(parsePhase('CLEAR')).toBeNull()
    expect(parsePhase('-P4')).toBeNull()
    expect(parsePhase('M1S-')).toBeNull()
  })
})

describe('phaseStage', () => {
  it('只取阶段部分，供 CSS class 使用', () => {
    expect(phaseStage('M2S-CLEAR')).toBe('CLEAR')
    expect(phaseStage('P2')).toBe('P2')
  })
})

describe('displayPhase', () => {
  it('单副本只显示阶段', () => {
    expect(displayPhase('P4', single)).toBe('P4')
    expect(displayPhase('CLEAR', single)).toBe('CLEAR')
  })

  it('多副本显示 "副本id · 阶段"', () => {
    expect(displayPhase('M2S-CLEAR', multi)).toBe('M2S · CLEAR')
    expect(displayPhase('M1S-P2', multi)).toBe('M1S · P2')
  })

  it('旧数据无副本前缀时原样显示', () => {
    expect(displayPhase('P2', multi)).toBe('P2')
  })
})
