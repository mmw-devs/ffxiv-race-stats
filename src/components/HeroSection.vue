<!-- HeroSection.vue — 英雄区（视频背景 + 标题 + 公告滚动面板） -->
<template>
  <section class="az-hero" id="top">
    <div class="az-hero-stage">
      <!-- 全屏视频背景：浏览器本地播放，减轻服务器压力 -->
      <div
        class="az-hero-video"
        data-hero
        style="--rd: 0.28s"
        aria-hidden="true"
        :style="videoFailed ? heroFallbackStyle : undefined"
      >
        <video
          v-show="!videoFailed"
          class="az-hero-shot"
          :src="VIDEO_SRC"
          :poster="VIDEO_POSTER"
          @error="onVideoError"
          autoplay
          muted
          loop
          playsinline
          preload="auto"
          tabindex="-1"
        ></video>
      </div>

      <!-- 标题浮层：浮于视频上方 -->
      <div class="az-hero-copy">
        <div class="az-container">
          <div class="az-hero-intro">
            <!-- 第一行：赛事眉题 -->
            <p class="az-kicker az-hero-kicker" data-hero style="--rd: 0.13s">FINALFANTASY · 2026</p>

            <!-- 第二行：主标题 + LIVE 徽标（绝对定位，不参与居中宽度计算） -->
            <h1 class="az-title" data-hero style="--rd: 0.18s">
              <span class="az-title-text">{{ meta.eventName }}</span>
              <span v-if="meta.status === 'live'" class="az-live-pill az-live-lg">
                <span class="az-live-dot" aria-hidden="true"></span>LIVE
              </span>
            </h1>

            <!-- 第三行：导语（不换行） -->
            <p class="az-lead" data-hero style="--rd: 0.23s">高难副本首杀争夺战——队伍进度、选手直播、赛事速报，一站式追踪。</p>

            <!-- 原有分割线保留，中央嵌入小菱形 -->
            <div class="az-hero-rule" data-hero style="--rd: 0.27s" aria-hidden="true">
              <span class="az-hero-diamond"></span>
            </div>

            <div class="az-hero-actions" data-hero style="--rd: 0.31s">
              <a class="az-btn az-btn-primary" href="#register">立即报名</a>
              <a class="az-btn az-btn-ghost az-btn-arrow" href="#ranking">查看实时排名</a>
            </div>
          </div>

          <!-- 赛事公告：紧随标题块下方（固定间距），与标题块一起作为整体居中 -->
          <div class="az-notices reveal" id="register">
            <div class="az-notices-head">
              <p class="az-panel-label">赛事公告</p>
              <span class="az-notices-scrolltag">AUTO SCROLL · LIVE FEED</span>
            </div>
            <div class="az-notices-scroll">
              <div class="az-notices-track" :style="rollStyle">
                <NoticeItem v-for="(n, i) in notices" :key="'a' + i" :text="n" />
                <template v-if="notices.length > 0">
                  <NoticeItem v-for="(n, i) in notices" :key="'b' + i" :text="n" aria-hidden="true" />
                </template>
              </div>
            </div>
            <button type="button" class="az-expand" @click="emit('open-notices')">查看全部 {{ notices.length }} 条</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import NoticeItem from './NoticeItem.vue'
import type { Meta } from '../../types/race-data'

const props = defineProps<{ meta: Meta; notices: string[] }>()
const emit = defineEmits<{ (e: 'open-notices'): void }>()

/**
 * 首页大屏视频：FFXIV 8.0「银海之天舟」先导预告片前 23 秒（已本地裁剪，浏览器播放）。
 * ⚠️ 换片必须同时改这里的文件名（带版本），否则已缓存的老访客看不到新视频 ——
 *    换片 SOP 与后续 CDN 迁移预案见 docs/frontend-architecture.md §4
 */
const VIDEO_SRC = '/hero-video-2026q3.mp4'
const VIDEO_POSTER = '/hero-video-poster.jpg'

// 视频加载失败时隐藏 video，用静态海报作为背景兜底（不引入小视频回退）
const videoFailed = ref(false)
function onVideoError(): void {
  videoFailed.value = true
}
const heroFallbackStyle = {
  background: `url(${VIDEO_POSTER}) center / cover no-repeat`,
}

/** 公告滚动速度：条目越多跑完一轮越慢 */
const rollStyle = computed<Record<string, string>>(() => ({
  '--roll-duration': Math.max(18, props.notices.length * 3.2) + 's',
}))
</script>
