<template>
  <div class="notice-card" :class="{ 'is-popped': expanded }">
    <span class="notice-label">赛事公告</span>
    <div v-for="(n, i) in notices" :key="i" class="sponsor-item" :class="{ 'is-hidden': i >= threshold && !expanded }">
      <p>{{ n }}</p>
    </div>
    <button v-if="notices.length > threshold" class="crt-expand" @click="toggle">
      {{ expanded ? '收起' : '展开全部 ' + notices.length + ' 条 +' }}
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
defineProps({ notices: { type: Array, default: () => [] } })
const threshold = 1
const expanded = ref(false)
function toggle() { expanded.value = !expanded.value }
</script>

<style scoped>
.notice-card {
  flex: 1; min-width: 0;
  border: 2px solid var(--border);
  padding: 10px 14px;
  background: var(--surface);
}
.notice-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--muted);
  text-transform: uppercase;
}
.sponsor-item {
  padding: 8px 0;
  border-bottom: 2px solid var(--border);
}
.sponsor-item:first-child { padding-top: 4px; }
.sponsor-item.is-hidden { display: none; }
.sponsor-item p {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg);
}
.is-popped {
  position: relative;
  z-index: 901;
  box-shadow: 0 8px 40px rgba(0,0,0,0.25);
}
.crt-expand {
  display: block;
  width: 100%;
  padding: 10px 0 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--muted);
  text-align: center;
  cursor: pointer;
  border: 2px solid transparent;
  background: none;
  transition: color 0.12s;
}
.crt-expand:hover { color: var(--accent); }
</style>
