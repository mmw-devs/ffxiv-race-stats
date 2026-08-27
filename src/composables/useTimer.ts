/**
 * useTimer.ts
 *
 * 开赛计时器 composable。
 * - startTimeStr 为 ISO 8601 字符串
 * - 每秒更新 elapsed（'+HH:MM:SS' 格式）
 * - 组件卸载时自动停止定时器
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue'

export interface UseTimerReturn {
  /** 当前已开赛时间显示（'+HH:MM:SS' 或 '--:--:--'） */
  elapsed: Ref<string>
  /** 获取原始文本（含'开赛'前缀） */
  getRawText: () => string
}

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return '+' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
}

export function useTimer(startTimeStr: string): UseTimerReturn {
  const elapsed = ref<string>('+00:00:00')
  let timer: ReturnType<typeof setInterval> | null = null
  const startTime = new Date(startTimeStr).getTime()
  const isValid = !isNaN(startTime)

  function tick(): void {
    if (!isValid) {
      elapsed.value = '--:--:--'
      return
    }
    const ms = Date.now() - startTime
    elapsed.value = formatElapsed(ms > 0 ? ms : 0)
  }

  onMounted(() => {
    if (!isValid) {
      elapsed.value = '--:--:--'
      return
    }
    tick()
    timer = setInterval(tick, 1000)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return {
    elapsed,
    getRawText() {
      return '开赛 ' + elapsed.value
    },
  }
}