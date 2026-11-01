<!-- RankingToolbar.vue — 排行榜工具栏（副本切换 + 右侧状态区插槽） -->
<template>
  <div class="az-ranking-toolbar">
    <div v-if="tabs.length > 0" class="az-dungeon-switch" role="group" aria-label="按副本查看">
      <button type="button" class="az-dungeon-tab" :class="{ 'is-active': selected === null }" :aria-pressed="selected === null" @click="emit('select', null)">全部</button>
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="az-dungeon-tab"
        :class="{ 'is-active': selected === tab.id }"
        :aria-pressed="selected === tab.id"
        :title="`${tab.name} · ${tab.count} 队当前在此层`"
        :aria-label="`${tab.name}，${tab.count} 队当前在此层`"
        @click="emit('select', tab.id)"
      >
        <span class="az-dungeon-id">{{ tab.id }}</span>
        <span class="az-dungeon-count">{{ tab.count }} 队</span>
      </button>
    </div>
    <slot name="sync" />
  </div>
</template>

<script setup lang="ts">
import type { DungeonTab } from '../domain/dungeon'

defineProps<{
  tabs: DungeonTab[]
  selected: string | null
}>()

const emit = defineEmits<{ (e: 'select', dungeonId: string | null): void }>()
</script>
