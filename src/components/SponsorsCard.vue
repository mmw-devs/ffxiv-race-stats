<template>
  <SidebarCard
    class="anim-entry"
    title="赞助公示"
    :items="sponsors"
    :threshold="3"
    expanded-key="sponsor"
  >
    <template #default="{ item }">
      <p style="font-weight:600">{{ item.name }}</p>
      <p class="sponsor-desc">{{ item.desc }}</p>
    </template>
  </SidebarCard>
</template>

<script setup>
import SidebarCard from './SidebarCard.vue'
defineProps({ sponsors: { type: Array, default: () => [] } })
</script>

<style scoped>
.sponsor-desc {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.4;
}
</style>