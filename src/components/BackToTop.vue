<!-- BackToTop.vue — 回顶按钮（滚动超过阈值后出现） -->
<template>
  <button
    type="button"
    class="az-backtop"
    :class="{ 'is-visible': visible }"
    :aria-hidden="!visible"
    :tabindex="visible ? 0 : -1"
    aria-label="回到页面顶部"
    title="回到顶部"
    @click="scrollTop"
  >
    ↑
  </button>
</template>

<script setup lang="ts">
import { useScrolledPast } from '../composables/useScroll'
import { prefersReducedMotion } from '../utils/motion'

/** 滚动超过该距离后显示回顶按钮；与 NavBar 共享滚动监听 */
const SHOW_AFTER = 400
const visible = useScrolledPast(SHOW_AFTER)

function scrollTop(): void {
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
  window.scrollTo({ top: 0, behavior })
}
</script>
