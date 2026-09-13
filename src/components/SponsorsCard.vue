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
      v-if="sponsors.length > 10"
      type="button"
      class="az-expand"
      :class="{ 'is-open': expanded }"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : '展开全部 ' + sponsors.length + ' 家赞助商' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

/** 赞助商项。schema 未指定 items，组件内局部类型约定为 { name; desc } */
interface Sponsor {
  name: string
  desc: string
}

const props = defineProps<{ sponsors: Sponsor[] }>()

const expanded = ref(false)
// 默认只展示前 10 家，展开后全量
const visibleSponsors = computed(() => (expanded.value ? props.sponsors : props.sponsors.slice(0, 10)))
</script>
