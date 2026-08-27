<template>
  <div class="crt-module anim-entry" :class="{ 'is-popped': expanded }">
    <h2>实时排名 TOP 10</h2>
    <RankingRow v-for="(team, i) in topTeams" :key="team.id" :team="team" :index="i" :dungeons="dungeons" />
    <RankingRow
      v-for="(team, i) in restTeams"
      :key="team.id"
      :team="team"
      :index="i + 10"
      :dungeons="dungeons"
      :class="{ 'is-hidden': !expanded }"
    />
    <button class="crt-expand" @click="toggle">
      {{ expanded ? '收起' : '展开全部 ' + (teams?.length ?? 0) + ' 队 +' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import RankingRow from './RankingRow.vue'
import { useExpand } from '../composables/useExpand.js'
import type { Team, Dungeon } from '../../types/race-data'

const props = defineProps<{
  teams?: Team[]
  dungeons?: Dungeon[]
}>()
const topTeams = computed(() => (props.teams ?? []).filter(t => t.rank <= 10))
const restTeams = computed(() => (props.teams ?? []).filter(t => t.rank > 10))

const expandedId = useExpand()
const expanded = computed(() => expandedId.value === 'ranking')
function toggle() { expandedId.value = expandedId.value === 'ranking' ? null : 'ranking' }
</script>

<style scoped>
.crt-module {
  background: oklch(96% 0.006 170);
  color: var(--fg);
  border: 2px solid var(--border);
  padding: 24px 20px;
  position: relative;
  overflow: hidden;
}
.crt-module::after {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.025) 2px, rgba(0,0,0,0.025) 4px);
  pointer-events: none;
  animation: scan-roll 4s linear infinite;
}
@keyframes scan-roll { from { background-position: 0 0; } to { background-position: 0 16px; } }
.crt-module h2 {
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}
.crt-module.is-popped {
  position: relative;
  z-index: 901;
  box-shadow: 0 8px 40px rgba(0,0,0,0.25);
}
:deep(.is-hidden) { display: none; }
.crt-expand {
  display: block;
  width: 100%;
  padding: 10px 0 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--muted);
  text-align: center;
  cursor: pointer;
  border: 2px solid transparent;
  background: none;
  transition: color 0.12s;
}
.crt-expand:hover { color: var(--accent); }
</style>
