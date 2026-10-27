import { computed, ref, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

export interface UseExpandableListReturn<T> {
  /** 是否已展开 */
  expanded: Ref<boolean>
  /** 条目数是否超过限制（决定是否渲染「展开全部」按钮） */
  canExpand: ComputedRef<boolean>
  /** 当前应渲染的条目 */
  visibleItems: ComputedRef<T[]>
  /** 在截断 / 全量之间切换；不可展开时为 no-op */
  toggle: () => void
}

/**
 * 「默认展示前 N 条、可展开全量」的共享状态。
 *
 * RankingTable / NewsTicker / SponsorsCard 此前各写了一份 expanded + computed，
 * 且 RankingTable 用 rank <= 15 过滤（依赖数据顺序与 rank 连续），与其他列表
 * 的 slice(0, N) 语义不一致。统一到这里后，「前 N 条」只由条目顺序决定。
 */
export function useExpandableList<T>(
  items: MaybeRefOrGetter<T[]>,
  limit: number
): UseExpandableListReturn<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('useExpandableList: limit 必须是正整数')
  }

  const expanded = ref(false)
  const source = computed(() => toValue(items))
  const canExpand = computed(() => source.value.length > limit)
  const visibleItems = computed<T[]>(() => {
    if (expanded.value && canExpand.value) return [...source.value]
    return source.value.slice(0, limit)
  })

  function toggle(): void {
    if (canExpand.value) expanded.value = !expanded.value
  }

  return { expanded, canExpand, visibleItems, toggle }
}
