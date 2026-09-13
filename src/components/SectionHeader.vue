<!-- SectionHeader.vue — 章节头（编号 / kicker / 标题 / folio） -->
<template>
  <div class="az-section-head reveal">
    <span class="az-index">{{ index }}</span>
    <div>
      <p class="az-kicker">{{ kicker }}</p>
      <h2>{{ title }}</h2>
    </div>
    <span class="az-folio">{{ folio }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  index: string
  kicker: string
  title: string
  folio: string
}>()
</script>
