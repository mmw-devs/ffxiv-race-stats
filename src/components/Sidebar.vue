<template>
  <aside>
    <LiveTimer :startTime="meta.startTime" :startLabel="startLabel" />
    <SponsorsCard :sponsors="sponsors" />
    <StreamCover :coverage="coverage" :teamCount="teamCount" />
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import LiveTimer from './LiveTimer.vue'
import SponsorsCard from './SponsorsCard.vue'
import StreamCover from './StreamCover.vue'

const props = defineProps({
  meta: Object,
  sponsors: Array,
  teams: Array,
  streamCoverage: Object,
})
const coverage = computed(() => props.streamCoverage || {})
const teamCount = computed(() => (props.teams || []).length)
const startLabel = computed(() => props.meta?.startTime ? new Date(props.meta.startTime).toISOString().slice(0, 10) + ' 起' : '')
</script>
