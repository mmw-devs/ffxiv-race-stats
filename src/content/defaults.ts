import type { Content } from '../../types/race-data'

/**
 * 迁移期兜底：ops 的 data.json 还没补 `content` 时，页面暂时使用这里与旧硬编码一致的文案。
 *
 * ⚠️ 这不是第二事实源，而是 expand/contract 迁移桥：
 *    ops 数据补齐 content → 把 root.schema.json 的 content 改为 required
 *    → 删除本文件，组件只读 data.json。
 */
export const DEFAULT_CONTENT: Content = {
  hero: {
    kicker: 'FINALFANTASY · 2026',
    lead: '高难副本首杀争夺战——队伍进度、选手直播、赛事速报，一站式追踪。',
    primaryCta: { label: '立即报名', href: '#register' },
    secondaryCta: { label: '查看实时排名', href: '#ranking' },
  },
  rules: {
    title: '赛事规则',
    kicker: 'RACE REGULATION',
    items: [
      '报名窗口以「赛事公告」公布的起止时间为准，逾期不予受理。',
      '每队由 8 名选手组成，职业不限，开赛前需完成队伍名单登记。',
      '以最新版本高难副本为竞速目标，按首次通关时间先后排序，榜单实时更新。',
      '进度与通关记录以官方日志为准，本页榜单为展示层，不参与最终裁决。',
      '使用第三方脚本、代打或共享账号等行为将取消成绩，完整细则以正式章程为准。',
    ],
  },
  seo: {
    title: 'FFXIV 高难首杀竞速',
    description: 'FFXIV 高难首杀竞速排行聚合平台，追踪高难副本的世界首杀争夺战，提供队伍进度、选手直播、赛事速报一站式浏览。',
  },
  media: {
    heroVideo: '/hero-video-2026q3.mp4',
    heroPoster: '/hero-video-poster.jpg',
  },
  sections: {
    ranking: { kicker: 'RACE REPORT', title: '实时排名' },
    news: { kicker: 'LIVE TIMELINE', title: '速报时间线' },
    sponsors: { kicker: 'SPONSORS', title: '赞助公示' },
    guides: { kicker: 'GUIDES', title: '副本攻略' },
  },
}
