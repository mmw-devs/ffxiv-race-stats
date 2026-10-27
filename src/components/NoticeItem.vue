<!-- NoticeItem.vue — 公告条目（hero 滚动面板 ↔ 弹窗共用同一条渲染路径） -->
<script setup lang="ts">
import { pad2 } from '../utils/format'

// 传入 index 时渲染编号（弹窗用），不传则为纯文本（hero 滚动面板用）。
defineProps<{ text: string; index?: number }>()
</script>

<template>
  <div class="az-notice-item">
    <span v-if="index !== undefined" class="az-notice-no">N.{{ pad2(index + 1) }}</span>
    <span>{{ text }}</span>
  </div>
</template>
