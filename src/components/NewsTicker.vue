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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { NewsItem } from '../../types/race-data'

const props = defineProps<{ news: NewsItem[] }>()

const expanded = ref(false)
// 默认只渲染前 10 条（与入场动画只对首批 10 条生效一致），展开后全量
const visibleNews = computed(() => (expanded.value ? props.news : props.news.slice(0, 10)))

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

const pad = (n: number): string => String(n).padStart(2, '0')

function localAbsolute(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function displayTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = now.value - t
  if (diff >= 0) {
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  }
  return localAbsolute(new Date(t))
}
</script>
