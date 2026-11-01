<!-- RankingRow.vue — 排名行（单支队伍：名次 / 队名 / 职业 / 血量 / 阶段） -->
<template>
  <div class="az-team" :class="medal">
    <span class="az-team-rank" :class="medal">{{ pad2(team.rank) }}</span>
    <span class="az-team-name">
      <span class="az-name-t">{{ team.name }}</span>
      <span class="az-region" :class="region.className">{{ region.label }}</span>
    </span>
    <div class="az-team-comp">
      <!-- 分组来自名册模块，行内只负责在组间插间隔，不再硬编码 2T/2H/4DPS 位置 -->
      <template v-for="(group, gi) in roster" :key="group.role">
        <span v-if="gi > 0" class="az-role-gap"></span>
        <template v-for="(p, pi) in group.players" :key="group.role + '-' + pi">
          <a
            v-if="isPlayerLive(p)"
            class="az-job is-live"
            :class="p.role"
            :href="p.stream"
            target="_blank"
            rel="noopener"
            :title="p.job + ' 第一视角直播'"
          >{{ p.job }}</a>
          <span v-else class="az-job" :class="p.role">{{ p.job }}</span>
        </template>
      </template>
    </div>
    <span class="az-team-hp">{{ formatBossHP(progress.bossHP) }}</span>
    <span class="az-team-phase" :class="phase.className">{{ phase.label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { selectPhaseView, selectRankMedal, selectRegionView } from '../selectors'
import { isPlayerLive, selectTeamProgress } from '../domain/team'
import { selectTeamRoster } from '../domain/roster'
import { formatBossHP, pad2 } from '../utils/format'
import type { Team, Dungeon } from '../../types/race-data'

const props = defineProps<{
  team: Team
  /** 副本列表（用于阶段显示：单副本隐藏名称、多副本显示 "id · stage"） */
  dungeons?: Dungeon[]
}>()

const medal = computed(() => selectRankMedal(props.team.rank))
const region = computed(() => selectRegionView(props.team.region))
const roster = computed(() => selectTeamRoster(props.team.players))

// 阶段/血量由 Team 聚合值对象统一解释。
const progress = computed(() => selectTeamProgress(props.team))
const phase = computed(() => selectPhaseView(progress.value.phase, props.dungeons ?? []))
</script>
