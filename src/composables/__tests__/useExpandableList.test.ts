import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useExpandableList } from '../useExpandableList'

describe('useExpandableList', () => {
  it('未展开时只渲染前 limit 项，展开后渲染全量', () => {
    const { expanded, canExpand, visibleItems, toggle } = useExpandableList(ref([1, 2, 3, 4]), 2)

    expect(expanded.value).toBe(false)
    expect(canExpand.value).toBe(true)
    expect(visibleItems.value).toEqual([1, 2])

    toggle()
    expect(expanded.value).toBe(true)
    expect(visibleItems.value).toEqual([1, 2, 3, 4])
  })

  it('条目数不超过 limit 时不可展开，toggle 为 no-op', () => {
    const { expanded, canExpand, visibleItems, toggle } = useExpandableList(ref([1, 2]), 2)

    expect(canExpand.value).toBe(false)
    expect(visibleItems.value).toEqual([1, 2])

    toggle()
    expect(expanded.value).toBe(false)
  })

  it('响应 items 变化', () => {
    const items = ref([1, 2])
    const { canExpand, visibleItems } = useExpandableList(items, 2)

    items.value = [1, 2, 3]
    expect(canExpand.value).toBe(true)
    expect(visibleItems.value).toEqual([1, 2])
  })

  it('limit 非正整数时抛错', () => {
    expect(() => useExpandableList(ref([]), 0)).toThrow()
  })
})
