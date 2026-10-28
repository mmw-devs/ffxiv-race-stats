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
      v-if="canExpand"
      type="button"
      class="az-expand"
      :class="{ 'is-open': expanded }"
      :aria-expanded="expanded"
      @click="toggle"
    >
      {{ expanded ? '收起' : '展开全部 ' + sortedTeams.length + ' 队' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import RankingRow from './RankingRow.vue'
import { useExpandableList } from '../composables/useExpandableList'
import { sortTeamsByRank } from '../utils/ranking'
import type { Team, Dungeon } from '../../types/race-data'

const props = defineProps<{
  teams: Team[]
  /** 副本列表（用于阶段显示，透传给 RankingRow） */
  dungeons?: Dungeon[]
}>()

// 数据契约只保证 rank 为 1..n 连续整数，不保证 teams[] 的数组顺序；
// 展示层始终按 rank 升序，默认收起时取前 15 名（而不是 rank <= 15）。
const sortedTeams = computed(() => sortTeamsByRank(props.teams))
const { expanded, canExpand, visibleItems: visibleTeams, toggle } = useExpandableList(sortedTeams, 15)
</script>
