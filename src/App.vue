<template>
  <div v-if="loading" class="loading">加载中...</div>
  <template v-else>
    <StatusBar
      :eventName="meta.eventName"
      :dataCenter="meta.dataCenter"
      :dungeon="meta.dungeon"
      :startTime="meta.startTime"
      :status="meta.status"
    />
    <header class="header">
      <div><div class="header-brand">FFXIV 高难首杀竞速网站</div></div>
    </header>
    <HeroSection :meta="meta" :notices="notices" :broadcasters="broadcasters" />
    <div class="main-grid">
      <RankingTable :teams="teams" />
      <Sidebar :meta="meta" :sponsors="sponsors" :teams="teams" :streamCoverage="streamCoverage" />
    </div>
    <NewsTicker :news="news" />
    <section class="placeholder-slot" id="guides">
      <h2>副本攻略</h2>
      <p>此区域预留给未来的副本攻略窗口，当前版本暂不实现。</p>
    </section>
    <AppFooter :eventName="meta.eventName" />
  </template>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import StatusBar from './components/StatusBar.vue'
import HeroSection from './components/HeroSection.vue'
import RankingTable from './components/RankingTable.vue'
import Sidebar from './components/Sidebar.vue'
import NewsTicker from './components/NewsTicker.vue'
import AppFooter from './components/AppFooter.vue'

const meta = ref({})
const teams = ref([])
const news = ref([])
const broadcasters = ref([])
const notices = ref([])
const sponsors = ref([])
const loading = ref(true)

// 直播覆盖统计
const streamCoverage = computed(() => {
  let totalPlayers = 0, streamingPlayers = 0, teamsWithCoverage = 0
  for (const t of teams.value) {
    let hasStream = false
    for (const p of t.players) {
      totalPlayers++
      if (p.streaming) { streamingPlayers++; hasStream = true }
    }
    if (hasStream) teamsWithCoverage++
  }
  return { totalPlayers, streamingPlayers, teamsWithCoverage }
})

onMounted(async () => {
  try {
    const resp = await fetch('/data.json')
    if (!resp.ok) throw new Error('加载失败: ' + resp.status)
    const data = await resp.json()
    meta.value = data.meta || {}
    teams.value = data.teams || []
    news.value = data.news || []
    broadcasters.value = data.broadcasters || []
    notices.value = data.notices || []
    sponsors.value = data.sponsors || []
  } catch (e) {
    console.error('数据加载失败:', e)
  } finally {
    loading.value = false
  }
})
</script>

<style>
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  font-family: var(--font-mono);
  color: var(--muted);
}
.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 24px 0 20px;
  border-bottom: 2px solid var(--border);
  margin-bottom: 32px;
  flex-wrap: wrap;
  gap: 16px;
}
.header-brand {
  font-family: var(--font-display);
  font-size: 18px;
  font-style: italic;
  color: var(--muted);
}
.main-grid {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 32px;
  margin-bottom: 48px;
  align-items: start;
}
@media (max-width: 860px) { .main-grid { grid-template-columns: 1fr; } }
.placeholder-slot {
  border: 2px dashed var(--border);
  padding: 32px 24px;
  text-align: center;
  margin-bottom: 48px;
}
.placeholder-slot h2 { margin-bottom: 8px; font-family: var(--font-display); font-weight: 700; font-size: 28px; }
.placeholder-slot p { font-size: 12px; color: var(--muted); margin: 0 auto; }
</style>
