<!-- App.vue — 根组件：编排取数 / 弹窗 / 滚动入场，向各区块下发 props -->
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
      <HeroSection
        :meta="meta"
        :notices="notices"
        :hero="pageContent.hero"
        :media="pageContent.media"
        @open-notices="openModal('notices')"
      />

      <PageSection
        id="ranking"
        :index="getSection('ranking').index"
        :kicker="pageContent.sections.ranking.kicker"
        :title="pageContent.sections.ranking.title"
        :folio="folio(getSection('ranking').page)"
      >
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
      </PageSection>

      <PageSection
        id="news"
        :index="getSection('news').index"
        :kicker="pageContent.sections.news.kicker"
        :title="pageContent.sections.news.title"
        :folio="folio(getSection('news').page)"
      >
        <NewsTicker :news="news" />
      </PageSection>

      <PageSection
        id="sponsors"
        :index="getSection('sponsors').index"
        :kicker="pageContent.sections.sponsors.kicker"
        :title="pageContent.sections.sponsors.title"
        :folio="folio(getSection('sponsors').page)"
      >
        <SponsorsCard :sponsors="sponsors" />
      </PageSection>

      <PageSection
        id="guides"
        :index="getSection('guides').index"
        :kicker="pageContent.sections.guides.kicker"
        :title="pageContent.sections.guides.title"
        :folio="folio(getSection('guides').page)"
      >
        <GuidesSection />
      </PageSection>
    </main>

    <AppFooter :event-name="meta.eventName ?? ''" :edition="meta.edition ?? ''" />

    <!-- 悬浮回顶端按钮 -->
    <BackToTop />

    <!-- 赛事规则弹窗 -->
    <Modal
      :open="activeModal === 'rules'"
      id="rules"
      :title="pageContent.rules.title"
      :kicker="pageContent.rules.kicker"
      :folio="folio('P.00')"
      @close="closeModal"
    >
      <ol class="az-rules">
        <li v-for="(rule, index) in pageContent.rules.items" :key="index">{{ rule }}</li>
      </ol>
    </Modal>

    <!-- 合作转播台弹窗 -->
    <Modal
      :open="activeModal === 'broadcast'"
      id="broadcast"
      title="合作转播台"
      kicker="COVERAGE"
      :folio="folio('P.00')"
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
      :folio="folio('P.00')"
      @close="closeModal"
    >
      <div class="az-notice-modal-list">
        <NoticeItem v-for="(n, i) in notices" :key="i" :text="n" :index="i" />
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import NavBar from './components/NavBar.vue'
import HeroSection from './components/HeroSection.vue'
import PageSection from './components/PageSection.vue'
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
import { getSection } from './sections'
import { usePageSeo } from './composables/usePageSeo'
import { useRaceData } from './composables/useRaceData'
import { useReveal } from './composables/useReveal'

// 取数 / 校验 / 错误态全部收敛在 composable 内，App 只负责编排。
const { meta, content, teams, news, broadcasters, notices, sponsors, loading, error, load } = useRaceData()
const { setup: setupReveal } = useReveal()

// content 在 schema 中是 required；组件只读 data.json，不再有代码兜底。
const pageContent = computed(() => content.value)
usePageSeo(() => pageContent.value.seo)

// 弹窗状态：同时间最多打开一个
type ModalKey = 'rules' | 'broadcast' | 'notices' | null
const activeModal = ref<ModalKey>(null)
function openModal(key: Exclude<ModalKey, null>): void { activeModal.value = key }
function closeModal(): void { activeModal.value = null }

/** 页面 folio 统一格式，避免各 section 手拼 VOL/P.xx。 */
function folio(page: string): string {
  return `VOL.${meta.value.edition ?? ''} · ${page}`
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
  const applied = await load()
  if (!applied) return
  await nextTick()
  setupReveal()
}

function reload(): void {
  void loadData()
}

onMounted(loadData)
</script>
