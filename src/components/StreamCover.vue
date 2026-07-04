<template>
  <div class="sidebar-card">
    <h3>直播覆盖</h3>
    <p class="cover-stat">
      <span class="cover-num count-up">{{ displayStream }}</span>
      <span class="cover-total"> / {{ coverage.totalPlayers }}</span>
    </p>
    <p class="cover-label">名选手直播中</p>
    <p class="cover-stat" style="margin-top:10px">
      <span class="cover-num count-up">{{ displayTeams }}</span>
      <span class="cover-total"> / {{ teamCount }}</span>
    </p>
    <p class="cover-label">支队伍有在线视角</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
  coverage: Object,
  teamCount: Number,
})

const displayStream = ref(0)
const displayTeams = ref(0)

function countUp(el, target, duration = 600) {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReduced) { el.value = target; return }
  const start = performance.now()
  const from = 0
  function tick(now) {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    const eased = 1 - (1 - progress) * (1 - progress)
    el.value = Math.round(from + (target - from) * eased)
    if (progress < 1) requestAnimationFrame(tick)
    else el.value = target
  }
  requestAnimationFrame(tick)
}

onMounted(() => {
  setTimeout(() => {
    if (props.coverage) {
      countUp(displayStream, props.coverage.streamingPlayers)
      countUp(displayTeams, props.coverage.teamsWithCoverage)
    }
  }, 500)
})
</script>

<style scoped>
.sidebar-card {
  border: 2px solid var(--border);
  padding: 16px;
  margin-bottom: 16px;
  background: var(--surface);
}
.sidebar-card h3 {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10px;
}
.cover-stat {
  font-family: var(--font-mono);
  font-size: 22px;
  line-height: 1.1;
  color: var(--fg);
}
.cover-total { font-size: 13px; color: var(--muted); }
.cover-label { margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--muted); }
</style>
