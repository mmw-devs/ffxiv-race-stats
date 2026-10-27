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
      <HeroSection :meta="meta" :notices="notices" @open-notices="openModal('notices')" />

      <section class="az-section" id="ranking">
        <div class="az-container">
          <SectionHeader index="01" kicker="RACE REPORT" title="实时排名" :folio="`VOL.${meta.edition ?? ''} · P.01`" />
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
          <SectionHeader index="02" kicker="LIVE TIMELINE" title="速报时间线" :folio="`VOL.${meta.edition ?? ''} · P.02`" />
          <NewsTicker :news="news" />
        </div>
      </section>

      <section class="az-section" id="sponsors">
        <div class="az-container">
          <SectionHeader index="03" kicker="SPONSORS" title="赞助公示" :folio="`VOL.${meta.edition ?? ''} · P.03`" />
          <SponsorsCard :sponsors="sponsors" />
        </div>
      </section>

      <section class="az-section" id="guides">
        <div class="az-container">
          <SectionHeader index="04" kicker="GUIDES" title="副本攻略" :folio="`VOL.${meta.edition ?? ''} · P.04`" />
          <GuidesSection />
        </div>
      </section>
    </main>

    <AppFooter :event-name="meta.eventName ?? ''" :edition="meta.edition ?? ''" />

    <!-- 悬浮回顶端按钮 -->
    <BackToTop />

    <!-- 赛事规则弹窗 -->
    <Modal
      :open="activeModal === 'rules'"
      id="rules"
      title="赛事规则"
      kicker="RACE REGULATION"
      :folio="`VOL.${meta.edition ?? ''} · P.00`"
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
      :folio="`VOL.${meta.edition ?? ''} · P.00`"
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
      :folio="`VOL.${meta.edition ?? ''} · P.00`"
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
import { useRaceData } from './composables/useRaceData'
import { useReveal } from './composables/useReveal'

// 取数 / 校验 / 错误态全部收敛在 composable 内，App 只负责编排。
const { meta, teams, news, broadcasters, notices, sponsors, loading, error, load } = useRaceData()
const { setup: setupReveal } = useReveal()

// 弹窗状态：同时间最多打开一个
type ModalKey = 'rules' | 'broadcast' | 'notices' | null
const activeModal = ref<ModalKey>(null)
function openModal(key: Exclude<ModalKey, null>): void { activeModal.value = key }
function closeModal(): void { activeModal.value = null }

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
