<!-- RankingSync.vue — 排行榜状态行（同步时间 / 手动刷新 / 未开赛与已结束说明） -->
<template>
  <div class="az-sync" :class="line.tone">
    <span class="az-sync-text" aria-live="polite" :title="toneTitle">{{ line.text }}</span>
    <button type="button" class="az-sync-btn" :disabled="line.actionDisabled" @click="emit('refresh')">{{ line.actionLabel }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useNow } from '../composables/useNow'
import { selectSyncLineView } from '../selectors'
import type { Meta } from '../../types/race-data'
import type { RaceSyncState } from '../composables/useRaceData'

const props = defineProps<{
  status: Meta['status']
  startTime: string
  sync: RaceSyncState
}>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

// 每秒校准一次：本地到开赛时刻的提示与「已同步」时间都依赖当前时刻。
const now = useNow(1000)

const line = computed(() =>
  selectSyncLineView(
    { status: props.status, startTime: props.startTime, sync: props.sync },
    now.value
  )
)

// 失败原因只放悬停提示，不在界面展开技术细节。
const toneTitle = computed(() => (line.value.tone === 'error' ? props.sync.error ?? '' : ''))
</script>
