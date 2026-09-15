<!-- RankingRow.vue — 排名行（单支队伍：名次 / 队名 / 职业 / 血量 / 阶段） -->
<template>
  <div class="az-team" :class="medalClass">
    <span class="az-team-rank" :class="medalClass">{{ padRank(team.rank) }}</span>
    <span class="az-team-name">
      <span class="az-name-t">{{ team.name }}</span>
      <span class="az-region" :class="'rg-' + regionKey">{{ team.region || '??' }}</span>
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
    <span class="az-team-phase" :class="phaseClass">{{ displayPhase }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
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

// 地区 / 阶段标签转小写，作为 CSS class 后缀（.rg-jp、.ph-1 …）
const regionKey = computed(() => (props.team.region || 'na').toLowerCase())
const phaseClass = computed(() => String(props.team.phase || '').toLowerCase())

/**
 * 阶段显示逻辑（#119 副本/阶段绑定）：
 * - phase 是复合 string "<副本id>-<阶段>"（如 M1S-P5、M2S-CLEAR）
 * - 单副本场景（dungeons.length <= 1）：只显示阶段（如 P5、CLEAR）
 * - 多副本场景：显示 "副本id · 阶段"（如 M1S · P5、M2S · CLEAR）
 */
const displayPhase = computed(() => {
  const phase = props.team.phase ?? ''
  const dashIdx = phase.indexOf('-')
  if (dashIdx < 0) return phase // 容错：旧数据无 '-' 时原样显示
  const stage = phase.slice(dashIdx + 1)
  const dungeons = props.dungeons ?? []
  if (dungeons.length <= 1) return stage
  const dungeonId = phase.slice(0, dashIdx)
  return `${dungeonId} · ${stage}`
})

// 名次补零显示为两位（1 → 01）
function padRank(n: number): string {
  return String(n).padStart(2, '0')
}
</script>
