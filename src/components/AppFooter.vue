<!-- AppFooter.vue — 页脚 -->
<template>
  <footer class="az-footer">
    <div class="az-container az-footer-inner">
      <div>
        <p class="az-footer-brand">FFXIV 高难首杀竞速网站</p>
        <p class="az-footer-meta">VOL. 01 · {{ eventName }} · © 2026 mmw 攻略组</p>
      </div>
      <div class="az-footer-links">
        <a href="#guides">副本攻略（即将推出）</a>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
defineProps<{ eventName: string }>()
</script>
