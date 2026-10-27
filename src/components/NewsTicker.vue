<!-- NewsTicker.vue — 速报时间线 -->
<template>
  <div class="az-news-wrap reveal">
    <div class="az-news">
      <div v-for="(n, i) in visibleNews" :key="n.id" class="az-news-item" :class="{ urgent: n.urgent }" :style="{ '--i': Math.min(i, 10) }">
        <time class="az-news-time az-num" :datetime="n.time">{{ displayTime(n.time) }}</time>
        <!-- 时间轴：竖线 + 节点（纯装饰） -->
        <span class="az-news-rail" aria-hidden="true"></span>
        <span class="az-news-text" :class="{ urgent: n.urgent }">{{ n.text }}</span>
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
      {{ expanded ? '收起' : '展开全部 ' + news.length + ' 条速报' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useExpandableList } from '../composables/useExpandableList'
import { formatNewsTime } from '../utils/time'
import type { NewsItem } from '../../types/race-data'

const props = defineProps<{ news: NewsItem[] }>()

// 默认只渲染前 10 条（与入场动画只对首批 10 条生效一致），展开后全量
const { expanded, canExpand, visibleItems: visibleNews, toggle } = useExpandableList(() => props.news, 10)

/**
 * 前端只展示访客本地时间。data.json 的 news[].time 统一存为含时区的
 * ISO 8601 瞬时（UTC 的 Z 或 ±HH:MM）。
 * 近期（24h 内）用相对时间，超过则用本地绝对时间 YYYY-MM-DD HH:MM（不带秒）。
 */

// 相对时间需要随时间流逝刷新（30s 粒度足够）
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => { if (timer) clearInterval(timer) })

function displayTime(iso: string): string {
  return formatNewsTime(iso, now.value)
}
</script>
