import { describe, expect, it } from 'vitest'
import { SECTIONS } from '../sections'
import { DEFAULT_CONTENT } from '../content/defaults'

describe('sections', () => {
  it('章节 id 与 content.sections 的键一致', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(Object.keys(DEFAULT_CONTENT.sections))
  })

  it('章节 id 唯一', () => {
    const ids = SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
