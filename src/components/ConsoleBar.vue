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
      <button v-if="broadcasters.length > BROADCAST_PREVIEW_LIMIT" type="button" class="az-expand" id="expandBroadcast" @click="emit('open-broadcast')">
        展开全部 {{ broadcasters.length }} 个转播台
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTimer } from '../composables/useTimer.js'
import { prefersReducedMotion } from '../utils/motion'
import { formatStartLabel } from '../utils/time'
import BroadcastItem from './BroadcastItem.vue'
import { BROADCAST_PREVIEW_LIMIT, selectPreviewBroadcasters } from '../domain/broadcast'
import type { Coverage } from '../types'
import type { Broadcaster } from '../../types/race-data'

const props = defineProps<{
  startTime: string
  coverage?: Coverage
  teamCount?: number
  broadcasters: Broadcaster[]
}>()
const emit = defineEmits<{ (e: 'open-broadcast'): void }>()

const { elapsed } = useTimer(() => props.startTime)

// "-" 是 schema 里「开赛时间未知」的占位符；直接 slice 会显示成 "- 起"。
const startLabel = computed(() => formatStartLabel(props.startTime))

/** 控制台仅展示前 3 个转播台，其余进入弹窗 */
const visibleBroadcasters = computed(() => selectPreviewBroadcasters(props.broadcasters))

// 数字滚动动画（尊重 reduced-motion）；coverage 变化时从当前值续加到新目标
const COVERAGE_ANIM_MS = 700
const displayStream = ref(0)
const displayTeams = ref(0)
let raf = 0

function animateCoverage(target: Coverage): void {
  if (raf !== 0) {
    cancelAnimationFrame(raf)
    raf = 0
  }

  if (prefersReducedMotion()) {
    displayStream.value = target.streamingPlayers
    displayTeams.value = target.teamsWithCoverage
    return
  }

  const fromStream = displayStream.value
  const fromTeams = displayTeams.value
  const start = performance.now()

  function tick(now: number): void {
    const progress = Math.min((now - start) / COVERAGE_ANIM_MS, 1)
    const eased = 1 - (1 - progress) * (1 - progress)
    displayStream.value = Math.round(fromStream + (target.streamingPlayers - fromStream) * eased)
    displayTeams.value = Math.round(fromTeams + (target.teamsWithCoverage - fromTeams) * eased)
    if (progress < 1) {
      raf = requestAnimationFrame(tick)
    } else {
      displayStream.value = target.streamingPlayers
      displayTeams.value = target.teamsWithCoverage
      raf = 0
    }
  }

  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  if (props.coverage) animateCoverage(props.coverage)
})
watch(() => props.coverage, (coverage) => {
  if (coverage) animateCoverage(coverage)
})
onUnmounted(() => {
  if (raf !== 0) cancelAnimationFrame(raf)
  raf = 0
})
</script>
