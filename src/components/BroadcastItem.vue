<!-- BroadcastItem.vue — 转播台条目（控制台 ↔ 弹窗共用同一条渲染路径） -->
<script setup lang="ts">
import { broadcastMonogram, broadcastTone } from '../composables/useBroadcast.js'
import type { Broadcaster } from '../../types/race-data'

defineProps<{ broadcaster: Broadcaster; index: number }>()
</script>

<template>
  <div class="az-broadcast-item">
    <span class="az-broadcast-avatar" :style="{ background: broadcastTone(index) }">{{ broadcastMonogram(index) }}</span>
    <div class="az-broadcast-info">
      <div class="az-broadcast-name">{{ broadcaster.name }}</div>
      <div class="az-broadcast-meta">{{ broadcaster.platform }} · {{ broadcaster.note }}</div>
    </div>
    <a class="az-broadcast-link" :href="broadcaster.url || '#'" target="_blank" rel="noopener">进入 →</a>
  </div>
</template>
