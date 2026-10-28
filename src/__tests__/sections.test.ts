import { describe, expect, it } from 'vitest'
import { SECTIONS } from '../sections'

describe('sections', () => {
  it('章节 id 与 data.json content.sections 的契约键一致', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(['ranking', 'news', 'sponsors', 'guides'])
  })

  it('章节 id 唯一', () => {
    const ids = SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
