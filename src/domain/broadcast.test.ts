import { describe, expect, it } from 'vitest'
import { BROADCAST_PREVIEW_LIMIT, selectBroadcasterHref, selectPreviewBroadcasters } from './broadcast'
import type { Broadcaster } from '../../types/race-data'

function broadcaster(id: string, url: string): Broadcaster {
  return { id, name: id, platform: 'bilibili', url, note: '' }
}

describe('selectPreviewBroadcasters', () => {
  it('只保留前 3 个', () => {
    const all = Array.from({ length: 5 }, (_, i) => broadcaster(`b${i}`, '#'))
    expect(selectPreviewBroadcasters(all)).toHaveLength(BROADCAST_PREVIEW_LIMIT)
  })
})

describe('selectBroadcasterHref', () => {
  it('只放行 # 与 http(s)', () => {
    expect(selectBroadcasterHref({ url: '#' })).toBe('#')
    expect(selectBroadcasterHref({ url: 'https://example.com' })).toBe('https://example.com')
    expect(selectBroadcasterHref({ url: 'javascript:alert(1)' })).toBe('#')
    expect(selectBroadcasterHref({ url: '' })).toBe('#')
  })
})
