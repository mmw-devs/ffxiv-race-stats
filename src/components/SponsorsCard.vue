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

<script setup lang="ts">
import SidebarCard from './SidebarCard.vue'

/** 赞助商项。schema 未指定 items，组件内局部类型约定为 { name; desc } */
interface Sponsor {
  name: string
  desc: string
}

defineProps<{ sponsors?: Sponsor[] }>()
</script>

<style scoped>
.sponsor-desc {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.4;
}
</style>