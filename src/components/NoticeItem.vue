<!-- NoticeItem.vue — 公告条目（hero 滚动面板 ↔ 弹窗共用同一条渲染路径） -->
<script setup lang="ts">
// 传入 index 时渲染编号（弹窗用），不传则为纯文本（hero 滚动面板用）。
defineProps<{ text: string; index?: number }>()

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
</script>

<template>
  <div class="az-notice-item">
    <span v-if="index !== undefined" class="az-notice-no">N.{{ pad2(index + 1) }}</span>
    <span>{{ text }}</span>
  </div>
</template>
