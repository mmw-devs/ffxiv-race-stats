<template>
  <footer class="site-footer">
    <span>FFXIV 高难首杀竞速网站 · {{ eventName }}</span>
    <span><a href="#archive">往期年鉴</a> · <a href="#guides">副本攻略（即将推出）</a></span>
  </footer>
</template>

<script setup lang="ts">
defineProps<{ eventName: string }>()
</script>

<style scoped>
.site-footer {
  margin-top: 32px;
  border-top: 2px solid var(--border);
  padding-top: 20px;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.site-footer a { color: var(--muted); }
</style>
