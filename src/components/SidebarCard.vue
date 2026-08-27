<template>
  <div class="sidebar-card" :class="[wrapperClass, { 'is-popped': expanded }]">
    <component :is="titleTag">{{ title }}</component>
    <div
      v-for="(item, i) in items"
      :key="i"
      class="sponsor-item"
      :class="{ 'is-hidden': i >= (threshold ?? 1) && !expanded }"
    >
      <slot :item="item" :index="i" />
    </div>
    <button v-if="(items?.length ?? 0) > (threshold ?? 1)" class="crt-expand" @click="toggle">
      {{ expanded ? '收起' : `展开全部 ${items?.length ?? 0} ${unit ?? '项'} +` }}
    </button>
  </div>
</template>

<script setup lang="ts" generic="T">
import { computed } from 'vue'
import { useExpand, type ExpandKey } from '../composables/useExpand.js'

const props = withDefaults(defineProps<{
  /** 卡片标题 */
  title: string
  /** 列表项（caller 决定每项的具体类型） */
  items?: T[]
  /** 折叠阈值，超过的项隐藏 */
  threshold?: number
  /** useExpand 互斥 key */
  expandedKey: ExpandKey
  /** 覆盖 wrapper 样式（如 notice-card 的 flex/min-width） */
  wrapperClass?: string
  /** 展开按钮文案（'条' / '项'） */
  unit?: string
  /** 标题元素标签（默认 h3，notice-card 等场景用 h2 保持层级） */
  titleTag?: 'h2' | 'h3' | 'h4'
}>(), {
  items: () => [] as T[],
  threshold: 1,
  wrapperClass: '',
  unit: '项',
  titleTag: 'h3',
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
.sidebar-card :is(h2, h3, h4) {
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