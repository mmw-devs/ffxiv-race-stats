<template>
  <aside>
    <div class="anim-entry"><LiveTimer :startTime="meta.startTime ?? ''" :startLabel="startLabel" /></div>
    <SponsorsCard :sponsors="sponsors" />
    <div class="anim-entry"><StreamCover :coverage="coverage" :teamCount="teamCount" /></div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import LiveTimer from './LiveTimer.vue'
import SponsorsCard from './SponsorsCard.vue'
import StreamCover, { type Coverage } from './StreamCover.vue'
import type { Meta, Team } from '../../types/race-data'

interface Sponsor {
  name: string
  desc: string
}

const props = defineProps<{
  meta: Meta
  sponsors?: Sponsor[]
  teams?: Team[]
  streamCoverage?: Coverage
}>()
const coverage = computed<Coverage>(() => props.streamCoverage ?? { totalPlayers: 0, streamingPlayers: 0, teamsWithCoverage: 0 })
const teamCount = computed(() => (props.teams ?? []).length)
const startLabel = computed(() => props.meta?.startTime ? new Date(props.meta.startTime).toISOString().slice(0, 10) + ' 起' : '')
</script>
