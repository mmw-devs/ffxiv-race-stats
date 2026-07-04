<template>
  <div class="crt-row">
    <span class="crt-rank" :class="rankStyle">#{{ team.rank }}</span>
    <span class="crt-team-name">
      {{ team.name }}
      <span class="crt-region">[{{ team.region || '??' }}]</span>
    </span>
    <div class="crt-comp">
      <template v-for="(p, pi) in team.players" :key="pi">
        <span v-if="pi === 2 || pi === 4" class="role-gap"></span>
        <a
          class="crt-job"
          :class="[p.role, { 'is-live': p.streaming }]"
          :href="p.stream"
          target="_blank"
          rel="noopener"
          :title="p.job + ' 第一视角直播'"
          :style="{ '--blink-phase': (pi * -0.11).toFixed(2) + 's' }"
        >{{ p.job }}</a>
      </template>
    </div>
    <span class="crt-hp">{{ team.bossHP.toFixed(1) }}%</span>
    <span class="crt-phase">{{ team.phase }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ team: Object, index: Number })

const rankStyle = computed(() => {
  if (props.index === 0) return 'n1'
  if (props.index === 1) return 'n2'
  if (props.index === 2) return 'n3'
  return ''
})
</script>

<style scoped>
.crt-row {
  display: grid;
  grid-template-columns: 32px minmax(40px, 1fr) auto 68px 56px;
  gap: 10px;
  align-items: center;
  padding: 9px 0;
  border-bottom: 2px solid var(--border);
  font-family: var(--font-mono);
  font-size: 13px;
  position: relative;
  z-index: 1;
  transition: background 0.15s ease, transform 0.15s ease;
}
.crt-row:hover { transform: translateX(4px); }
.crt-rank { font-size: 18px; color: var(--muted); text-align: center; }
.crt-rank.n1 { color: var(--accent); }
.crt-rank.n2, .crt-rank.n3 { color: var(--fg); }
.crt-team-name { font-weight: 600; line-height: 1.2; white-space: nowrap; }
.crt-region {
  font-size: 9px;
  color: var(--muted);
  letter-spacing: 0.08em;
  margin-left: 4px;
}
.crt-comp { display: flex; gap: 3px; align-items: center; white-space: nowrap; }
.crt-job {
  width: 34px; height: 28px;
  display: grid; place-items: center;
  position: relative;
  font-family: var(--font-mono);
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--bg);
  text-decoration: none;
  transition: transform 0.18s ease;
}
.crt-job:hover { transform: scale(1.15); }
.crt-job:not(.is-live) { filter: brightness(0.7); }
.crt-job.is-live::after {
  content: "";
  position: absolute;
  top: 1px; right: 1px;
  width: 4px; height: 4px;
  background: var(--bg);
  animation: dot-blink 0.8s ease-in-out infinite;
  animation-delay: var(--blink-phase, 0s);
}
@keyframes dot-blink {
  0%, 100% { opacity: 0; }
  25%, 60%  { opacity: 1; }
}
.crt-job.tank   { background: oklch(48% 0.12 255); }
.crt-job.healer { background: oklch(48% 0.12 170); }
.crt-job.dps    { background: oklch(48% 0.14 25); }
.role-gap { width: 2px; }
.crt-hp { text-align: right; color: var(--muted); }
.crt-phase { text-align: center; color: var(--muted); font-size: 11px; }

@media (max-width: 960px) {
  .crt-row { grid-template-columns: 28px minmax(36px, 1fr) auto 52px 40px; gap: 6px; font-size: 11px; }
  .crt-job { width: 28px; height: 22px; font-size: 8px; }
}
@media (max-width: 680px) {
  .crt-row { grid-template-columns: 24px 1fr 44px; gap: 4px; }
  .crt-comp, .crt-phase, .crt-hp { display: none; }
}

.crt-row:last-child { border-bottom: none; }

@media (prefers-reduced-motion: reduce) {
  .crt-row { transition: none; }
  .crt-row:hover { transform: none; }
  .crt-job:hover { transform: none; }
}
</style>
