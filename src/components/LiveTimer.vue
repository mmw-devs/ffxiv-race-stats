<template>
  <div class="sidebar-card">
    <h3>开赛计时</h3>
    <div class="timer-display">{{ elapsed }}</div>
    <div class="timer-meta">{{ startLabel }}</div>
  </div>
</template>

<script setup>
import { useTimer } from '../composables/useTimer.js'
const props = defineProps({ startTime: String, startLabel: String })
const { elapsed } = useTimer(props.startTime)
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
.timer-display {
  font-family: var(--font-mono);
  font-size: 36px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--fg);
}
.timer-meta {
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
}
</style>
