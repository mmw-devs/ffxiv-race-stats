// 开赛计时器 composable
import { ref, onMounted, onUnmounted } from 'vue'

function pad2(n) { return (n < 10 ? '0' : '') + n }

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return '+' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
}

export function useTimer(startTimeStr) {
  const elapsed = ref('+00:00:00')
  let timer = null
  const startTime = new Date(startTimeStr).getTime()

  function tick() {
    const ms = Date.now() - startTime
    elapsed.value = formatElapsed(ms > 0 ? ms : 0)
  }

  onMounted(() => {
    tick()
    timer = setInterval(tick, 1000)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return { elapsed, getRawText() { return '开赛 ' + elapsed.value } }
}
