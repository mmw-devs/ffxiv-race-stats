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
import { ref, onMounted, onUnmounted } from 'vue'

/** 滚动超过该距离后显示回顶按钮 */
const SHOW_AFTER = 400
const visible = ref(false)

function onScroll(): void {
  visible.value = window.scrollY > SHOW_AFTER
}

function scrollTop(): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>
