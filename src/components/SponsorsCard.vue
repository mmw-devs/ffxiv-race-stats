<template>
  <div class="sidebar-card" :class="{ 'is-popped': expanded }">
    <h3>赞助公示</h3>
    <div v-for="(s, i) in sponsors" :key="i" class="sponsor-item" :class="{ 'is-hidden': i >= threshold && !expanded }">
      <p style="font-weight:600">{{ s.name }}</p>
      <p class="sponsor-desc">{{ s.desc }}</p>
    </div>
    <button v-if="sponsors.length > threshold" class="crt-expand" @click="toggle">
      {{ expanded ? '收起' : '展开全部 ' + sponsors.length + ' 项 +' }}
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
defineProps({ sponsors: { type: Array, default: () => [] } })
const threshold = 3
const expanded = ref(false)
function toggle() { expanded.value = !expanded.value }
</script>

<style scoped>
.sidebar-card {
  border: 2px solid var(--border);
  padding: 16px;
  margin-bottom: 16px;
  background: var(--surface);
}
.sidebar-card h3 {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10px;
}
.sponsor-item {
  padding: 8px 0;
  border-bottom: 2px solid var(--border);
}
.sponsor-item:first-child { padding-top: 4px; }
.sponsor-item.is-hidden { display: none; }
.sponsor-desc {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.4;
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
