<!-- NavBar.vue — 粘性导航（品牌 / 锚点 / 计时 / LIVE / 规则按钮） -->
<template>
  <header class="az-nav" :class="{ 'is-scrolled': scrolled }" id="masthead">
    <div class="az-container az-nav-inner">
      <a class="az-brand" href="#top">FFXIV 竞速档案<span class="az-brand-sub">Race Archive</span></a>
      <nav class="az-nav-links" aria-label="主导航">
        <a v-for="section in SECTIONS" :key="section.id" :href="'#' + section.id">{{ section.navLabel }}</a>
      </nav>
      <span class="az-nav-meta">
        <span class="az-nav-timer">
          <svg class="az-clock" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.6" stroke="currentColor" stroke-width="1" />
            <path d="M6 3.6v2.4l1.7 1" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="az-num">{{ elapsed }}</span>
        </span>
        <span v-if="isLive" class="az-live-pill">
          <span class="az-live-dot" aria-hidden="true"></span>LIVE
        </span>
      </span>
      <button type="button" class="az-rules-link az-rules-nav" @click="emit('open-rules')">赛事规则</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTimer } from '../composables/useTimer.js'
import { useScrolledPast } from '../composables/useScroll'
import { selectIsLive } from '../selectors'
import { SECTIONS } from '../sections'
import type { Meta } from '../../types/race-data'

const props = defineProps<{ startTime: string; status: Meta['status'] }>()
const emit = defineEmits<{ (e: 'open-rules'): void }>()

const { elapsed } = useTimer(() => props.startTime)
const isLive = computed(() => selectIsLive(props.status))

// 滚动超过 12px 后给导航加背景/阴影（is-scrolled class）；与 BackToTop 共享滚动监听
const scrolled = useScrolledPast(12)
</script>
