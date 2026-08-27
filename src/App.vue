<template>
  <div v-if="error" class="error-banner" role="alert">
    <strong>数据加载失败</strong>
    <p>{{ error }}</p>
    <button class="error-reload" @click="reload">重新加载</button>
  </div>
  <div v-else-if="loading" class="loading">加载中...</div>
  <template v-else>
    <StatusBar
      :eventName="meta.eventName" :dataCenter="meta.dataCenter"
      :dungeon="meta.dungeon" :startTime="meta.startTime" :status="meta.status"
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
    <!-- 全屏遮罩层（仅展开时渲染，避免 position:fixed 覆盖问题） -->
    <Teleport to="body">
      <div v-if="expandedId !== null" class="ranking-overlay" @click="expandedId = null"></div>
    </Teleport>
  </template>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useExpand } from './composables/useExpand.js'
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
const error = ref(null)

// 展开态互斥：同一时间只有一个模块展开（'ranking' | 'sponsor' | 'notice' | null）
const expandedId = useExpand()

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

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const resp = await fetch('/data.json')
    if (!resp.ok) throw new Error('加载失败: HTTP ' + resp.status)
    const data = await resp.json()
    meta.value = data.meta || {}
    teams.value = data.teams || []
    news.value = data.news || []
    broadcasters.value = data.broadcasters || []
    notices.value = data.notices || []
    sponsors.value = data.sponsors || []
  } catch (e) {
    console.error('数据加载失败:', e)
    error.value = (e && e.message) ? e.message : '未知错误，请稍后重试'
  } finally {
    loading.value = false
    // 等待 Vue 渲染 DOM 后再启动入场序列
    await nextTick()
    startEntrySequence()
  }
}

function reload() {
  loadData()
}

onMounted(loadData)

// 入场序列：用 animation-delay 错开各模块的入场动画
function startEntrySequence() {
  const entries = document.querySelectorAll('.anim-entry')
  entries.forEach((el, i) => {
    el.style.animationDelay = (i * 70) + 'ms'
  })
}
</script>

<style>
.loading {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; font-family: var(--font-mono); color: var(--muted);
}
.error-banner {
  margin: 24px 0;
  padding: 16px 20px;
  border: 2px solid var(--live);
  background: oklch(98% 0.04 28);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.error-banner strong {
  font-weight: 700;
  letter-spacing: 0.04em;
}
.error-banner p {
  margin: 0;
  flex: 1;
  min-width: 200px;
  color: var(--muted);
}
.error-reload {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  padding: 6px 14px;
  border: 2px solid var(--fg);
  background: var(--fg);
  color: var(--bg);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.error-reload:hover { background: var(--bg); color: var(--fg); }
.header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 24px 0 20px; border-bottom: 2px solid var(--border);
  margin-bottom: 32px; flex-wrap: wrap; gap: 16px;
}
.header-brand {
  font-family: var(--font-display); font-size: 18px;
  font-style: italic; color: var(--muted);
}
.main-grid {
  display: grid; grid-template-columns: 1fr 280px;
  gap: 32px; margin-bottom: 48px; align-items: start;
}
@media (max-width: 860px) { .main-grid { grid-template-columns: 1fr; } }
.placeholder-slot {
  border: 2px dashed var(--border); padding: 32px 24px;
  text-align: center; margin-bottom: 48px;
}
.placeholder-slot h2 { margin-bottom: 8px; }
.placeholder-slot p { font-size: 12px; color: var(--muted); margin: 0 auto; }

/* 全屏遮罩 */
.ranking-overlay {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
}

/* 入场动画 — 使用 animation（一次性播放 + forwards 保持终态），避免 transition 被 Vue patch 重新触发 */
.anim-entry {
  animation: entry-in 0.45s ease both;
}
@keyframes entry-in {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .anim-entry { animation: none; }
}
</style>
