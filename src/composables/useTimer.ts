/**
 * useTimer.ts
 *
 * 开赛计时器 composable。
 * - startTime 为 ISO 8601 字符串（或 schema 允许的 "-" 占位）
 * - 复用全局共享时钟 useNow，多个组件只维持一个 interval
 * - startTime 变化时自动重算（不依赖组件挂载时的快照）
 * - 组件卸载时自动退订
 */

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useNow } from './useNow'
import { formatElapsed, parseInstant } from '../utils/time'

export interface UseTimerReturn {
  /** 当前已开赛时间显示（'+HH:MM:SS' 或 '--:--:--'） */
  elapsed: ComputedRef<string>
}

export function useTimer(startTime: MaybeRefOrGetter<string>): UseTimerReturn {
  const now = useNow()

  const elapsed = computed(() => {
    const start = parseInstant(toValue(startTime))
    if (!start) return '--:--:--'
    return formatElapsed(now.value - start.getTime())
  })

  return { elapsed }
}
