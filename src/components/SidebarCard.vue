<template>
  <div class="sidebar-card" :class="[wrapperClass, { 'is-popped': expanded }]">
    <h3>{{ title }}</h3>
    <div
      v-for="(item, i) in items"
      :key="i"
      class="sponsor-item"
      :class="{ 'is-hidden': i >= threshold && !expanded }"
    >
      <slot :item="item" :index="i" />
    </div>
    <button v-if="items.length > threshold" class="crt-expand" @click="toggle">
      {{ expanded ? '收起' : `展开全部 ${items.length} ${unit} +` }}
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useExpand } from '../composables/useExpand.js'

const props = defineProps({
  title: { type: String, required: true },
  items: { type: Array, default: () => [] },
  threshold: { type: Number, default: 1 },
  expandedKey: { type: String, required: true },
  wrapperClass: { type: String, default: '' },
  unit: { type: String, default: '项' },
})

const expandedId = useExpand()
const expanded = computed(() => expandedId.value === props.expandedKey)
function toggle() {
  expandedId.value = expandedId.value === props.expandedKey ? null : props.expandedKey
}
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