<!-- ConsoleBar.vue — 控制台三格（计时 / 直播覆盖 / 转播台） -->
<template>
  <div class="az-console reveal">
    <!-- 开赛计时 -->
    <div class="az-console-cell">
      <p class="az-panel-label">开赛计时</p>
      <div class="az-timer-display az-num">{{ elapsed }}</div>
      <div class="az-timer-meta">{{ startLabel }}</div>
    </div>

    <!-- 直播覆盖 -->
    <div class="az-console-cell">
      <p class="az-panel-label">直播覆盖</p>
      <p class="az-cover-stat">
        <span class="az-cover-num az-num">{{ displayStream }}</span>
        <span class="az-cover-total"> / {{ coverage?.totalPlayers ?? 0 }}</span>
      </p>
      <p class="az-cover-label">名选手直播中</p>
      <p class="az-cover-stat">
        <span class="az-cover-num az-num">{{ displayTeams }}</span>
        <span class="az-cover-total"> / {{ teamCount ?? 0 }}</span>
      </p>
      <p class="az-cover-label">支队伍有在线视角</p>
    </div>

    <!-- 合作转播台 -->
    <div class="az-console-cell">
      <p class="az-panel-label">合作转播台</p>
      <BroadcastItem v-for="(b, i) in visibleBroadcasters" :key="b.id" :broadcaster="b" :index="i" />
      <button v-if="broadcasters.length > 3" type="button" class="az-expand" id="expandBroadcast" @click="emit('open-broadcast')">
        展开全部 {{ broadcasters.length }} 个转播台
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTimer } from '../composables/useTimer.js'
import BroadcastItem from './BroadcastItem.vue'
import type { Broadcaster } from '../../types/race-data'

/** 直播覆盖统计。由 App.vue 从 data.json 计算后传入。 */
interface Coverage {
  totalPlayers: number
  streamingPlayers: number
  teamsWithCoverage: number
}

const props = defineProps<{
  startTime: string
  coverage?: Coverage
  teamCount?: number
  broadcasters: Broadcaster[]
}>()
const emit = defineEmits<{ (e: 'open-broadcast'): void }>()

const { elapsed } = useTimer(props.startTime)

const startLabel = computed(() => {
  if (!props.startTime) return ''
  return props.startTime.slice(0, 10) + ' 起'
})

/** 控制台仅展示前 3 个转播台，其余进入弹窗 */
const visibleBroadcasters = computed(() => props.broadcasters.slice(0, 3))

// 数字滚动动画（尊重 reduced-motion）
const displayStream = ref(0)
const displayTeams = ref(0)

function countUp(el: { value: number }, target: number, duration = 700): void {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReduced) { el.value = target; return }
  const start = performance.now()
  const from = 0
  function tick(now: number): void {
    const progress = Math.min((now - start) / duration, 1)
    const eased = 1 - (1 - progress) * (1 - progress)
    el.value = Math.round(from + (target - from) * eased)
    if (progress < 1) requestAnimationFrame(tick)
    else el.value = target
  }
  requestAnimationFrame(tick)
}

onMounted(() => {
  if (props.coverage) {
    countUp(displayStream, props.coverage.streamingPlayers)
    countUp(displayTeams, props.coverage.teamsWithCoverage)
  }
})
</script>
