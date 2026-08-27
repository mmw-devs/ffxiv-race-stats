<template>
  <SidebarCard
    title="赛事公告"
    :items="notices"
    :threshold="1"
    expanded-key="notice"
    wrapper-class="notice-card"
    unit="条"
  >
    <template #default="{ item }">
      <p>{{ item }}</p>
    </template>
  </SidebarCard>
</template>

<script setup lang="ts">
import SidebarCard from './SidebarCard.vue'

/** 公告项。schema 未指定 items，组件内局部类型约定为 string */
type Notice = string

defineProps<{ notices?: Notice[] }>()
</script>

<style scoped>
/* :deep() 穿透到 SidebarCard 根元素（NoticeCard 不持有 SidebarCard 内部 DOM 的 data-v） */
:deep(.sidebar-card.notice-card) {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
}
:deep(.sidebar-card.notice-card h3) {
  font-size: 10px;
}
/* slot 渲染的 <p> 由 NoticeCard 模板持有，自动归属 NoticeCard 的 data-v，无需 :deep() */
.sponsor-item p {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg);
}
</style>