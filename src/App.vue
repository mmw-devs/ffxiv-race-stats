<!-- App.vue — 根组件：fetch /data.json → validateRaceData 校验 → props 下发 -->
<template>
  <div v-if="error" class="az-error" role="alert">
    <strong>数据加载失败</strong>
    <p>{{ error }}</p>
    <button class="az-error-reload" @click="reload">重新加载</button>
  </div>
  <div v-else-if="loading" class="az-loading">加载中…</div>
  <div v-else class="az-root">
    <NavBar
      :start-time="meta.startTime ?? ''"
      :status="meta.status"
      @open-rules="openModal('rules')"
    />

    <main>
      <HeroSection :meta="meta" :notices="notices" @open-notices="openModal('notices')" />

      <section class="az-section" id="ranking">
        <div class="az-container">
          <SectionHeader index="01" kicker="RACE REPORT" title="实时排名" folio="VOL.01 · P.01" />
          <ConsoleBar
            :start-time="meta.startTime ?? ''"
            :coverage="coverage"
            :team-count="teams.length"
            :broadcasters="broadcasters"
            @open-broadcast="openModal('broadcast')"
          />
          <div class="az-main-grid">
            <RankingTable :teams="teams" :dungeons="meta.dungeons ?? []" />
          </div>
        </div>
      </section>

      <section class="az-section" id="news">
        <div class="az-container">
          <SectionHeader index="02" kicker="LIVE TIMELINE" title="速报时间线" folio="VOL.01 · P.02" />
          <NewsTicker :news="news" />
        </div>
      </section>

      <section class="az-section" id="sponsors">
        <div class="az-container">
          <SectionHeader index="03" kicker="SPONSORS" title="赞助公示" folio="VOL.01 · P.03" />
          <SponsorsCard :sponsors="sponsors" />
        </div>
      </section>

      <section class="az-section" id="guides">
        <div class="az-container">
          <SectionHeader index="04" kicker="GUIDES" title="副本攻略" folio="VOL.01 · P.04" />
          <GuidesSection />
        </div>
      </section>
    </main>

    <AppFooter :event-name="meta.eventName ?? ''" />

    <!-- 悬浮回顶端按钮 -->
    <BackToTop />

    <!-- 赛事规则弹窗 -->
    <Modal
      :open="activeModal === 'rules'"
      id="rules"
      title="赛事规则"
      kicker="RACE REGULATION"
      folio="VOL.01 · P.00"
      @close="closeModal"
    >
      <ol class="az-rules">
        <li>报名窗口以「赛事公告」公布的起止时间为准，逾期不予受理。</li>
        <li>每队由 8 名选手组成，职业不限，开赛前需完成队伍名单登记。</li>
        <li>以最新版本高难副本为竞速目标，按首次通关时间先后排序，榜单实时更新。</li>
        <li>进度与通关记录以官方日志为准，本页榜单为展示层，不参与最终裁决。</li>
        <li>使用第三方脚本、代打或共享账号等行为将取消成绩，完整细则以正式章程为准。</li>
      </ol>
    </Modal>

    <!-- 合作转播台弹窗 -->
    <Modal
      :open="activeModal === 'broadcast'"
      id="broadcast"
      title="合作转播台"
      kicker="COVERAGE"
      folio="VOL.01 · P.00"
      wide
      @close="closeModal"
    >
      <div class="az-broadcast-modal-list">
        <BroadcastItem v-for="(b, i) in broadcasters" :key="b.id" :broadcaster="b" :index="i" />
      </div>
    </Modal>

    <!-- 赛事公告弹窗 -->
    <Modal
      :open="activeModal === 'notices'"
      id="notices"
      title="赛事公告"
      kicker="NOTICE"
      folio="VOL.01 · P.00"
      @close="closeModal"
    >
      <div class="az-notice-modal-list">
        <NoticeItem v-for="(n, i) in notices" :key="i" :text="n" :index="i" />
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, type Ref } from 'vue'
import NavBar from './components/NavBar.vue'
import HeroSection from './components/HeroSection.vue'
import SectionHeader from './components/SectionHeader.vue'
import ConsoleBar from './components/ConsoleBar.vue'
import RankingTable from './components/RankingTable.vue'
import NewsTicker from './components/NewsTicker.vue'
import SponsorsCard from './components/SponsorsCard.vue'
import GuidesSection from './components/GuidesSection.vue'
import AppFooter from './components/AppFooter.vue'
import Modal from './components/Modal.vue'
import BackToTop from './components/BackToTop.vue'
import BroadcastItem from './components/BroadcastItem.vue'
import NoticeItem from './components/NoticeItem.vue'
import { validateRaceData } from './utils/validateRaceData'
import type { Meta, Team, NewsItem, Broadcaster } from '../types/race-data'

interface Sponsor {
  name: string
  desc: string
}

const meta: Ref<Meta> = ref<Meta>({} as Meta)
const teams: Ref<Team[]> = ref<Team[]>([])
const news: Ref<NewsItem[]> = ref<NewsItem[]>([])
const broadcasters: Ref<Broadcaster[]> = ref<Broadcaster[]>([])
const notices: Ref<string[]> = ref<string[]>([])
const sponsors: Ref<Sponsor[]> = ref<Sponsor[]>([])
const loading = ref(true)
const error: Ref<string | null> = ref<string | null>(null)

// 弹窗状态：同时间最多打开一个
type ModalKey = 'rules' | 'broadcast' | 'notices' | null
const activeModal = ref<ModalKey>(null)
function openModal(key: Exclude<ModalKey, null>): void { activeModal.value = key }
function closeModal(): void { activeModal.value = null }
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') activeModal.value = null
}

// 直播覆盖统计
const coverage = computed(() => {
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

async function loadData(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const resp = await fetch('/data.json')
    if (!resp.ok) throw new Error('加载失败: HTTP ' + resp.status)
    const data = await resp.json()
    const check = validateRaceData(data)
    if (!check.ok) {
      throw new Error('数据形状校验失败: ' + check.errors.join('；'))
    }
    meta.value = (data.meta || {}) as Meta
    teams.value = (data.teams || []) as Team[]
    news.value = (data.news || []) as NewsItem[]
    broadcasters.value = (data.broadcasters || []) as Broadcaster[]
    notices.value = (data.notices || []) as string[]
    sponsors.value = (data.sponsors || []) as Sponsor[]
  } catch (e) {
    console.error('数据加载失败:', e)
    error.value = (e instanceof Error && e.message) ? e.message : '未知错误，请稍后重试'
  } finally {
    loading.value = false
    await nextTick()
    setupReveal()
  }
}

function reload(): void {
  loadData()
}

// 滚动入场：交错 reveal 各模块
function setupReveal(): void {
  const els = document.querySelectorAll<HTMLElement>('.reveal')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!('IntersectionObserver' in window) || reduced) {
    els.forEach(el => el.classList.add('in-view'))
    return
  }
  // threshold 用 0.01 + 底部 -60px 内缩：
  // ① 比视口还高的区块（展开后的排名表/速报列表）也能触发，不会因比例达不到阈值而永远不可见
  // ② 元素真正进入视口 60px 后再入场，避免“刚露个边就闪一下”
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('in-view')
        io.unobserve(en.target)
      }
    })
  }, { threshold: 0.01, rootMargin: '0px 0px -60px 0px' })
  els.forEach((el, i) => {
    el.style.setProperty('--reveal-delay', (i % 4) * 90 + 'ms')
    io.observe(el)
  })
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  loadData()
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>
