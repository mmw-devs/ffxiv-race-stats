<!-- TeamDetail.vue — 队伍详情内容（名册 / 在播视角 / 当前状态） -->
<template>
  <div class="az-team-detail">
    <div class="az-team-detail-summary">
      <span class="az-detail-rank" :class="medal">{{ pad2(team.rank) }}</span>
      <span class="az-region" :class="region.className">{{ region.label }}</span>
      <span class="az-team-phase" :class="phase.className">{{ phase.label }}</span>
      <span class="az-detail-hp">Boss {{ formatBossHP(progress.bossHP) }}</span>
    </div>

    <p class="az-detail-live">{{ liveSummary }}</p>

    <div class="az-roster">
      <section v-for="group in roster" :key="group.role" class="az-roster-group">
        <p class="az-panel-label">{{ group.label }}</p>
        <ul class="az-roster-list">
          <li
            v-for="(player, index) in group.players"
            :key="group.role + '-' + index"
            class="az-roster-player"
            :class="player.role"
          >
            <span class="az-roster-job">{{ player.job }}</span>
            <a
              v-if="isPlayerLive(player)"
              class="az-roster-link"
              :href="player.stream"
              target="_blank"
              rel="noopener"
            >直播中 ↗</a>
            <span v-else class="az-roster-off">未开播</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { selectPhaseView, selectRankMedal, selectRegionView } from '../selectors'
import { isPlayerLive, selectTeamProgress } from '../domain/team'
import { selectLiveStreams, selectTeamRoster } from '../domain/roster'
import { formatBossHP, pad2 } from '../utils/format'
import type { Dungeon, Team } from '../../types/race-data'

const props = defineProps<{
  team: Team
  dungeons: Dungeon[]
}>()

const medal = computed(() => selectRankMedal(props.team.rank))
const region = computed(() => selectRegionView(props.team.region))
const progress = computed(() => selectTeamProgress(props.team))
const phase = computed(() => selectPhaseView(progress.value.phase, props.dungeons))
const roster = computed(() => selectTeamRoster(props.team.players))
const liveStreams = computed(() => selectLiveStreams(props.team))
const liveSummary = computed(() =>
  liveStreams.value.length > 0 ? `${liveStreams.value.length} 个视角正在直播` : '本队暂无选手直播'
)
</script>
