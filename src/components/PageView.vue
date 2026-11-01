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
            :status="meta.status"
            :coverage="coverage"
            :team-count="teams.length"
            :broadcasters="broadcasters"
            @open-broadcast="openModal('broadcast')"
          />
          <RankingToolbar
            v-if="dungeonTabs.length > 0"
            :tabs="dungeonTabs"
            :selected="selectedDungeonId"
            @select="selectDungeon"
          />
          <p v-if="dungeonSummary" class="az-dungeon-summary">{{ dungeonSummary }}</p>
          <div class="az-main-grid">
            <RankingTable
              v-if="visibleTeams.length > 0"
              :teams="visibleTeams"
              :dungeons="meta.dungeons"
              :focus-dungeon-id="selectedDungeonId"
              @select-team="openTeam"
            />
            <div v-else class="az-dungeon-empty">
              <p>{{ selectedDungeonId === null ? '暂无队伍数据' : '该副本暂无队伍' }}</p>
              <button v-if="selectedDungeonId !== null" type="button" class="az-expand" @click="selectDungeon(null)">查看全部</button>
            </div>
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

    <!-- 队伍详情弹窗 -->
    <Modal
      :open="selectedTeam !== null"
      id="team"
      :title="selectedTeam?.name ?? ''"
      :kicker="selectedTeamKicker"
      :folio="folio('P.01')"
      wide
      @close="closeTeam"
    >
      <TeamDetail v-if="selectedTeam" :team="selectedTeam" :dungeons="meta.dungeons" />
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import NavBar from './NavBar.vue'
import HeroSection from './HeroSection.vue'
import PageSection from './PageSection.vue'
import ConsoleBar from './ConsoleBar.vue'
import RankingTable from './RankingTable.vue'
import RankingToolbar from './RankingToolbar.vue'
import NewsTicker from './NewsTicker.vue'
import SponsorsCard from './SponsorsCard.vue'
import GuidesSection from './GuidesSection.vue'
import AppFooter from './AppFooter.vue'
import Modal from './Modal.vue'
import BackToTop from './BackToTop.vue'
import BroadcastItem from './BroadcastItem.vue'
import NoticeItem from './NoticeItem.vue'
import TeamDetail from './TeamDetail.vue'
import { SECTIONS } from '../sections'
import { selectCopyrightYear, selectDungeonSummary, selectFolio } from '../selectors'
import { pad2 } from '../utils/format'
import { filterTeamsByDungeon, selectDungeonTabs } from '../domain/dungeon'
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

// 队伍详情：只存队伍 id，内容每次从最新数据读取（刷新后自动跟随/失效）。
const selectedTeamId = ref<string | null>(null)
const selectedTeam = computed(() =>
  selectedTeamId.value === null
    ? null
    : teams.value.find((team) => team.id === selectedTeamId.value) ?? null
)
const selectedTeamKicker = computed(() =>
  selectedTeam.value ? `RANK ${pad2(selectedTeam.value.rank)} · ${selectedTeam.value.region}` : ''
)

function openTeam(teamId: string): void {
  activeModal.value = null
  selectedTeamId.value = teamId
}
function closeTeam(): void {
  selectedTeamId.value = null
}

// 刷新后队伍被删除时自动关闭；换层/改名则弹窗内容就地更新。
watch(selectedTeam, (team) => {
  if (selectedTeamId.value !== null && team === null) selectedTeamId.value = null
})

/** 页面 folio 统一格式，避免各 section 手拼 VOL/P.xx。 */
function folio(page: string): string {
  return selectFolio(meta.value, page)
}

// 直播覆盖统计
const coverage = computed(() => selectCoverage(teams.value))
const copyrightYear = computed(() => selectCopyrightYear(meta.value))

// 副本切换：视图状态只在 PageView；计数/过滤全部来自 domain/dungeon。
const selectedDungeonId = ref<string | null>(null)
const dungeonTabs = computed(() => selectDungeonTabs(teams.value, meta.value.dungeons))
const activeDungeonTab = computed(() =>
  selectedDungeonId.value === null
    ? null
    : dungeonTabs.value.find((tab) => tab.id === selectedDungeonId.value) ?? null
)
const dungeonSummary = computed(() => selectDungeonSummary(activeDungeonTab.value))
const visibleTeams = computed(() =>
  filterTeamsByDungeon(teams.value, meta.value.dungeons, selectedDungeonId.value)
)

function selectDungeon(dungeonId: string | null): void {
  selectedDungeonId.value = dungeonId
}

// 刷新后副本列表变化：选中的层不存在时回到「全部」。
watch(dungeonTabs, (tabs) => {
  if (selectedDungeonId.value !== null && !tabs.some((tab) => tab.id === selectedDungeonId.value)) {
    selectedDungeonId.value = null
  }
})
</script>
