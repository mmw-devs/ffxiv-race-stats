<!-- NewsTicker.vue — 速报时间线 -->
<template>
  <div class="az-news-wrap reveal">
    <div class="az-news">
      <div v-for="(n, i) in visibleNews" :key="n.id" class="az-news-item" :class="{ urgent: n.urgent }" :style="{ '--i': Math.min(i, 10) }">
        <span class="az-news-time az-num">{{ n.time }}</span>
        <!-- 时间轴：竖线 + 节点（纯装饰） -->
        <span class="az-news-rail" aria-hidden="true"></span>
        <span class="az-news-text" :class="{ urgent: n.urgent }">{{ n.text }}</span>
      </div>
    </div>
    <button
      v-if="news.length > 10"
      type="button"
      class="az-expand"
      :class="{ 'is-open': expanded }"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : '展开全部 ' + news.length + ' 条速报' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { NewsItem } from '../../types/race-data'

const props = defineProps<{ news: NewsItem[] }>()

const expanded = ref(false)
// 默认只渲染前 10 条（与入场动画只对首批 10 条生效一致），展开后全量
const visibleNews = computed(() => (expanded.value ? props.news : props.news.slice(0, 10)))
</script>
