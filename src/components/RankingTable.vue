<!-- RankingTable.vue — 排名表格 -->
<template>
  <div class="az-ledger reveal">
    <div class="az-ledger-head">
      <span class="az-lh-rank">RANK</span>
      <span class="az-lh-team">TEAM</span>
      <span class="az-lh-comp">COMP</span>
      <span class="az-lh-hp">BOSS HP</span>
      <span class="az-lh-phase">PHASE</span>
    </div>

    <RankingRow v-for="team in visibleTeams" :key="team.id" :team="team" :dungeons="dungeons" />

    <button
      v-if="teams.length > 15"
      type="button"
      class="az-expand"
      :class="{ 'is-open': expanded }"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : '展开全部 ' + teams.length + ' 队' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import RankingRow from './RankingRow.vue'
import type { Team, Dungeon } from '../../types/race-data'

const props = defineProps<{
  teams: Team[]
  /** 副本列表（用于阶段显示，透传给 RankingRow） */
  dungeons?: Dungeon[]
}>()

const expanded = ref(false)
// 默认只显示前 15 名（rank<=15），点击展开后全量
const visibleTeams = computed(() => (expanded.value ? props.teams : props.teams.filter(t => t.rank <= 15)))
</script>
