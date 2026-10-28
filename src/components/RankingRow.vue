<!-- RankingRow.vue — 排名行（单支队伍：名次 / 队名 / 职业 / 血量 / 阶段） -->
<template>
  <div class="az-team" :class="medalClass">
    <span class="az-team-rank" :class="medalClass">{{ pad2(team.rank) }}</span>
    <span class="az-team-name">
      <span class="az-name-t">{{ team.name }}</span>
      <span class="az-region" :class="regionKey ? 'rg-' + regionKey : ''">{{ team.region || '??' }}</span>
    </span>
    <div class="az-team-comp">
      <template v-for="(p, pi) in team.players" :key="pi">
        <!-- pi===2/4 处插分组间隔：坦克(0-1) | 治疗(2-3) | DPS(4-7)，8 人分三组 -->
        <span v-if="pi === 2 || pi === 4" class="az-role-gap"></span>
        <a
          v-if="p.streaming"
          class="az-job is-live"
          :class="p.role"
          :href="p.stream || '#'"
          target="_blank"
          rel="noopener"
          :title="p.job + ' 第一视角直播'"
        >{{ p.job }}</a>
        <span v-else class="az-job" :class="p.role">{{ p.job }}</span>
      </template>
    </div>
    <span class="az-team-hp">{{ team.bossHP.toFixed(1) }}%</span>
    <span class="az-team-phase" :class="phase.className">{{ phase.label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { selectPhaseView } from '../selectors'
import { pad2 } from '../utils/format'
import type { Team, Dungeon } from '../../types/race-data'

const props = defineProps<{
  team: Team
  /** 副本列表（用于阶段显示：单副本隐藏名称、多副本显示 "id · stage"） */
  dungeons?: Dungeon[]
}>()

// 前三名奖牌三色（金 n1 / 银 n2 / 铜 n3），其余名次无特殊色
const medalClass = computed(() => {
  if (props.team.rank === 1) return 'n1'
  if (props.team.rank === 2) return 'n2'
  if (props.team.rank === 3) return 'n3'
  return ''
})

// 地区标签转小写，作为 CSS class 后缀（.rg-jp、.rg-na …）；空值不加色，文本仍显示 ??
const regionKey = computed(() => (props.team.region || '').toLowerCase())

// 阶段展示由 selector 统一解释：只取 stage 做 CSS class，文本按副本数决定前缀。
const phase = computed(() => selectPhaseView(props.team.phase ?? '', props.dungeons ?? []))
</script>
