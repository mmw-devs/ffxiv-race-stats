<template>
  <section class="news-section">
    <h2 class="anim-entry">速报时间线</h2>
    <TransitionGroup name="news">
      <div v-for="n in news" :key="n.id" class="ticker-item">
        <span class="ticker-time">{{ n.time }}</span>
        <span class="ticker-text" :class="{ urgent: n.urgent }">{{ n.text }}</span>
      </div>
    </TransitionGroup>
  </section>
</template>

<script setup lang="ts">
import type { NewsItem } from '../../types/race-data'
defineProps<{ news: NewsItem[] }>()
</script>

<style scoped>
.news-section { margin-bottom: 48px; }
.news-section h2 {
  padding-bottom: 14px;
  border-bottom: 2px solid var(--border);
  margin-bottom: 16px;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
}
.ticker-item {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 14px;
  padding: 9px 0;
  border-bottom: 2px solid var(--border);
  font-size: 13px;
  align-items: baseline;
}
.ticker-time {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.ticker-text.urgent { color: var(--warn); }
.news-enter-active { animation: news-in 0.4s linear; }
.news-leave-active { animation: news-in 0.4s linear reverse; }
@keyframes news-in { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
</style>
