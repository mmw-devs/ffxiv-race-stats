<!-- App.vue — 根组件：只负责数据状态（loading / error / ready），页面主体交给 PageView -->
<template>
  <div v-if="state.status === 'error'" class="az-error" role="alert">
    <strong>数据加载失败</strong>
    <p>{{ state.message }}</p>
    <button class="az-error-reload" @click="reload">重新加载</button>
  </div>
  <div v-else-if="state.status === 'loading'" class="az-loading">加载中…</div>
  <PageView v-else-if="state.status === 'ready'" :data="state.data" />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import PageView from './components/PageView.vue'
import { useRaceData } from './composables/useRaceData'

const { state, load } = useRaceData()

function reload(): void {
  void load()
}

onMounted(load)
</script>
