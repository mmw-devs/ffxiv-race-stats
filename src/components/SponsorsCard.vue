<!-- SponsorsCard.vue — 赞助公示 -->
<template>
  <div class="az-sponsor-panel reveal">
    <div class="az-sponsor-list">
      <div v-for="(s, i) in visibleSponsors" :key="s.name" class="az-sponsor-item" :style="{ '--i': Math.min(i, 10) }">
        <p class="az-sponsor-name">{{ s.name }}</p>
        <p class="az-sponsor-desc">{{ s.desc }}</p>
      </div>
    </div>
    <button
      v-if="canExpand"
      type="button"
      class="az-expand"
      :class="{ 'is-open': expanded }"
      :aria-expanded="expanded"
      @click="toggle"
    >
      {{ expanded ? '收起' : '展开全部 ' + sponsors.length + ' 家赞助商' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { useExpandableList } from '../composables/useExpandableList'
import type { Sponsor } from '../types'

const props = defineProps<{ sponsors: Sponsor[] }>()

// 默认只展示前 10 家，展开后全量
const { expanded, canExpand, visibleItems: visibleSponsors, toggle } = useExpandableList(() => props.sponsors, 10)
</script>
