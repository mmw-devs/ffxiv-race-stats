import { onMounted, onUnmounted, readonly, ref, type Ref } from 'vue'

/**
 * 全站共享的秒级时钟。
 *
 * 导航栏和控制台都需要「当前时间」来算开赛时长。如果各自 setInterval，
 * 页面就会有多个同频定时器；这里收敛成一个，并让所有消费者读同一个 ref。
 * 页面隐藏时暂停 interval，重新可见时立即校准，避免后台标签页空转。
 */
const now = ref(Date.now())
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null
let listening = false

function tick(): void {
  now.value = Date.now()
}

function startTimer(): void {
  if (timer !== null || typeof window === 'undefined' || document.hidden) return
  tick()
  timer = setInterval(tick, 1000)
}

function stopTimer(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function onVisibilityChange(): void {
  if (document.hidden) {
    stopTimer()
    return
  }
  tick()
  startTimer()
}

function subscribe(): void {
  subscribers++
  tick()
  if (subscribers !== 1 || typeof window === 'undefined') return
  startTimer()
  if (!listening) {
    document.addEventListener('visibilitychange', onVisibilityChange)
    listening = true
  }
}

function unsubscribe(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  stopTimer()
  if (listening && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    listening = false
  }
}

/**
 * 订阅共享时钟。必须在组件 setup 中调用（依赖 onMounted / onUnmounted）。
 * 首次读取时先校准一次，避免组件挂载前 now 停留在模块加载时刻。
 */
export function useNow(): Readonly<Ref<number>> {
  if (typeof window !== 'undefined' && subscribers === 0) tick()
  onMounted(subscribe)
  onUnmounted(unsubscribe)
  return readonly(now)
}
