<!-- PageSection.vue — 单个页面章节外壳（id / 编号 / 章节头 / 容器） -->
<template>
  <section class="az-section" :id="id">
    <div class="az-container">
      <SectionHeader :index="index" :kicker="kicker" :title="title" :folio="folio" />
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import SectionHeader from './SectionHeader.vue'
import type { SectionId } from '../sections'

defineProps<{
  id: SectionId
  index: string
  kicker: string
  title: string
  folio: string
}>()
</script>
