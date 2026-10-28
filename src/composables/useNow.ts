import { onMounted, onUnmounted, readonly, ref, type Ref } from 'vue'

interface Clock {
  now: Ref<number>
  intervalMs: number
  subscribers: number
  timer: ReturnType<typeof setInterval> | null
  listener: (() => void) | null
}

/**
 * 全站共享时钟，按 interval 分组。
 *
 * 导航/控制台用 1s，速报相对时间用 30s；同频消费者共享一个 interval，
 * 页面隐藏时暂停，重新可见时立即校准，避免后台标签页空转。
 */
const clocks = new Map<number, Clock>()

function tick(clock: Clock): void {
  clock.now.value = Date.now()
}

function getClock(intervalMs: number): Clock {
  const existing = clocks.get(intervalMs)
  if (existing) return existing
  const clock: Clock = {
    now: ref(Date.now()),
    intervalMs,
    subscribers: 0,
    timer: null,
    listener: null,
  }
  clocks.set(intervalMs, clock)
  return clock
}

function startTimer(clock: Clock): void {
  if (clock.timer !== null || typeof window === 'undefined' || document.hidden) return
  tick(clock)
  clock.timer = setInterval(() => tick(clock), clock.intervalMs)
}

function stopTimer(clock: Clock): void {
  if (clock.timer === null) return
  clearInterval(clock.timer)
  clock.timer = null
}

function onVisibilityChange(clock: Clock): void {
  if (document.hidden) {
    stopTimer(clock)
    return
  }
  tick(clock)
  startTimer(clock)
}

function subscribe(clock: Clock): void {
  clock.subscribers++
  tick(clock)
  if (clock.subscribers !== 1 || typeof window === 'undefined') return
  startTimer(clock)
  if (!clock.listener) {
    clock.listener = () => onVisibilityChange(clock)
    document.addEventListener('visibilitychange', clock.listener)
  }
}

function unsubscribe(clock: Clock): void {
  clock.subscribers = Math.max(0, clock.subscribers - 1)
  if (clock.subscribers > 0) return
  stopTimer(clock)
  if (clock.listener) {
    document.removeEventListener('visibilitychange', clock.listener)
    clock.listener = null
  }
}

/**
 * 订阅共享时钟。必须在组件 setup 中调用（依赖 onMounted / onUnmounted）。
 * 同一 interval 的消费者共享一个 timer；首次读取时先校准一次。
 */
export function useNow(intervalMs = 1000): Readonly<Ref<number>> {
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new Error('useNow: intervalMs 必须是正整数')
  }
  const clock = getClock(intervalMs)
  if (typeof window !== 'undefined' && clock.subscribers === 0) tick(clock)
  onMounted(() => subscribe(clock))
  onUnmounted(() => unsubscribe(clock))
  return readonly(clock.now)
}
