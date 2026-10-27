import { computed, onMounted, onUnmounted, readonly, ref, type ComputedRef, type Ref } from 'vue'

/**
 * 共享滚动位置。
 *
 * NavBar（滚动后加背景）和 BackToTop（滚动超过阈值出现）此前各注册一个
 * scroll 监听；这里收敛成一个 passive 监听 + 每帧最多更新一次。
 */
const scrollY = ref(0)
let subscribers = 0
let frame = 0

function paint(): void {
  frame = 0
  scrollY.value = window.scrollY
}

function onScroll(): void {
  if (frame !== 0) return
  frame = requestAnimationFrame(paint)
}

function subscribe(): void {
  scrollY.value = window.scrollY
  if (subscribers === 0) window.addEventListener('scroll', onScroll, { passive: true })
  subscribers++
}

function unsubscribe(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  window.removeEventListener('scroll', onScroll)
  if (frame !== 0) {
    cancelAnimationFrame(frame)
    frame = 0
  }
}

/** 订阅共享滚动位置；必须在组件 setup 中调用。 */
export function useScrollY(): Readonly<Ref<number>> {
  onMounted(subscribe)
  onUnmounted(unsubscribe)
  return readonly(scrollY)
}

/** 滚动是否超过指定阈值。 */
export function useScrolledPast(threshold: number): ComputedRef<boolean> {
  const y = useScrollY()
  return computed(() => y.value > threshold)
}
