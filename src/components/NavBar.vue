<!-- NavBar.vue — 粘性导航（品牌 / 锚点 / 计时 / LIVE / 规则按钮） -->
<template>
  <header class="az-nav" :class="{ 'is-scrolled': scrolled }" id="masthead">
    <div class="az-container az-nav-inner">
      <a class="az-brand" href="#top">FFXIV 竞速档案<span class="az-brand-sub">Race Archive</span></a>
      <nav class="az-nav-links" aria-label="主导航">
        <a href="#ranking">实时排名</a>
        <a href="#news">速报</a>
        <a href="#sponsors">赞助</a>
        <a href="#guides">攻略</a>
      </nav>
      <span class="az-nav-meta">
        <span class="az-nav-timer">
          <svg class="az-clock" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.6" stroke="currentColor" stroke-width="1" />
            <path d="M6 3.6v2.4l1.7 1" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="az-num">{{ elapsed }}</span>
        </span>
        <span v-if="status === 'live'" class="az-live-pill">
          <span class="az-live-dot" aria-hidden="true"></span>LIVE
        </span>
      </span>
      <button type="button" class="az-rules-link az-rules-nav" @click="emit('open-rules')">赛事规则</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useTimer } from '../composables/useTimer.js'

const props = defineProps<{ startTime: string; status: string }>()
const emit = defineEmits<{ (e: 'open-rules'): void }>()

const { elapsed } = useTimer(props.startTime)

// 滚动超过 12px 后给导航加背景/阴影（is-scrolled class）
const scrolled = ref(false)
function onScroll(): void {
  scrolled.value = window.scrollY > 12
}
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>
