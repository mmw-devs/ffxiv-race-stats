<template>
  <div class="status-bar">
    <span class="status-event">{{ eventName }} · 第 2 日</span>
    <span class="status-dc">{{ dataCenter }} · {{ dungeon }}</span>
    <span class="status-timer">开赛 {{ elapsed }}</span>
    <span v-if="status === 'live'" class="live-indicator">LIVE</span>
  </div>
</template>

<script setup>
import { useTimer } from '../composables/useTimer.js'
const props = defineProps({
  eventName: String,
  dataCenter: String,
  dungeon: String,
  startTime: String,
  status: String,
})
const { elapsed } = useTimer(props.startTime)
</script>

<style scoped>
.status-bar {
  background: oklch(14% 0.005 260);
  color: oklch(96% 0.002 260);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  margin: 20px 0 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  border: 2px solid var(--border);
  flex-wrap: wrap;
  gap: 12px;
}
.status-event { color: var(--accent); font-weight: 600; }
.status-dc    { color: oklch(65% 0.005 260); }
.status-timer { color: oklch(96% 0.002 260); font-weight: 600; }
.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--live);
  color: oklch(98% 0.004 90);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 5px 14px;
  margin: -10px 0;
}
.live-indicator::before {
  content: "";
  width: 6px; height: 6px;
  background: oklch(98% 0.004 90);
  animation: led-blink 1.2s steps(2) infinite;
}
@keyframes led-blink { 50% { opacity: 0.15; } }
@media (max-width: 680px) { .status-bar { font-size: 10px; } }
@media (prefers-reduced-motion: reduce) {
  .live-indicator::before { animation: none; }
}
</style>
