/**
 * useTimer.ts
 *
 * 计时器 composable：把「赛事状态 + 开赛时间 + 当前时刻」交给
 * selectors.selectTimerView，导航与控制台消费同一个视图。
 *
 * - 复用全局共享时钟 useNow，多个组件只维持一个 interval
 * - 状态 / 开赛时间变化时自动重算
 * - 组件卸载时自动退订
 */

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useNow } from './useNow'
import { selectTimerView, type TimerView } from '../selectors'
import type { Meta } from '../../types/race-data'

export interface UseTimerReturn {
  timer: ComputedRef<TimerView>
}

export function useTimer(meta: MaybeRefOrGetter<Pick<Meta, 'status' | 'startTime'>>): UseTimerReturn {
  const now = useNow()
  const timer = computed(() => selectTimerView(toValue(meta), now.value))
  return { timer }
}
