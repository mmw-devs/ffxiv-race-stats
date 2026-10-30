<!-- PageView.vue — 数据 ready 后的页面主体（导航 / 章节 / 弹窗） -->
<template>
  <div class="az-root">
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
        v-for="section in SECTIONS"
        :key="section.id"
        :id="section.id"
        :index="section.index"
        :kicker="pageContent.sections[section.id].kicker"
        :title="pageContent.sections[section.id].title"
        :folio="folio(section.page)"
      >
        <template v-if="section.id === 'ranking'">
          <ConsoleBar
            :start-time="meta.startTime ?? ''"
            :coverage="coverage"
            :team-count="teams.length"
            :broadcasters="broadcasters"
            @open-broadcast="openModal('broadcast')"
          />
          <div class="az-main-grid">
            <RankingTable :teams="teams" :dungeons="meta.dungeons" />
          </div>
        </template>
        <NewsTicker v-else-if="section.id === 'news'" :news="news" />
        <SponsorsCard v-else-if="section.id === 'sponsors'" :sponsors="sponsors" />
        <GuidesSection v-else-if="section.id === 'guides'" />
      </PageSection>
    </main>

    <AppFooter :event-name="meta.eventName" :edition="meta.edition ?? ''" :year="copyrightYear" />

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
import { computed, onMounted, ref } from 'vue'
import NavBar from './NavBar.vue'
import HeroSection from './HeroSection.vue'
import PageSection from './PageSection.vue'
import ConsoleBar from './ConsoleBar.vue'
import RankingTable from './RankingTable.vue'
import NewsTicker from './NewsTicker.vue'
import SponsorsCard from './SponsorsCard.vue'
import GuidesSection from './GuidesSection.vue'
import AppFooter from './AppFooter.vue'
import Modal from './Modal.vue'
import BackToTop from './BackToTop.vue'
import BroadcastItem from './BroadcastItem.vue'
import NoticeItem from './NoticeItem.vue'
import { SECTIONS } from '../sections'
import { selectCopyrightYear, selectFolio } from '../selectors'
import { selectCoverage } from '../domain/coverage'
import { usePageMotion } from '../composables/usePageMotion'
import { usePageSeo } from '../composables/usePageSeo'
import { useReveal } from '../composables/useReveal'
import type { RaceData } from '../types'

const props = defineProps<{ data: RaceData }>()

const meta = computed(() => props.data.meta)
const pageContent = computed(() => props.data.content)
const teams = computed(() => props.data.teams)
const news = computed(() => props.data.news)
const broadcasters = computed(() => props.data.broadcasters)
const notices = computed(() => props.data.notices)
const sponsors = computed(() => props.data.sponsors)

// SEO 只在 PageView 挂载（data ready）后执行，避免空 content 读取。
usePageSeo(() => pageContent.value.seo)

// 页面动效由 PageView 拥有；滚动复用 useScroll 的共享 rAF。
usePageMotion()

// 页面挂载后统一注册 reveal；PageView 只在 ready 时挂载，DOM 已就绪。
const { setup: setupReveal } = useReveal()
onMounted(() => setupReveal())

// 弹窗状态：同时间最多打开一个
type ModalKey = 'rules' | 'broadcast' | 'notices' | null
const activeModal = ref<ModalKey>(null)
function openModal(key: Exclude<ModalKey, null>): void { activeModal.value = key }
function closeModal(): void { activeModal.value = null }

/** 页面 folio 统一格式，避免各 section 手拼 VOL/P.xx。 */
function folio(page: string): string {
  return selectFolio(meta.value, page)
}

// 直播覆盖统计
const coverage = computed(() => selectCoverage(teams.value))
const copyrightYear = computed(() => selectCopyrightYear(meta.value))
</script>
