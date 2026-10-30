/**
 * 由 scripts/generate-types.mjs 自动生成 — 请勿手动编辑
 * 数据源：agent-src/schema/*.schema.json
 * 重新生成：npm run typegen
 */

/**
 * 赛事公告条目（短文本，按运营给定顺序展示）
 */
export type Notice = string;

/**
 * FFXIV 竞速排名数据顶层结构
 */
export interface RACE_DATA {
  meta: Meta;
  content: Content;
  teams: Team[];
  news: NewsItem[];
  broadcasters: Broadcaster[];
  notices: Notice[];
  sponsors: Sponsor[];
  [k: string]: unknown;
}
/**
 * 赛事元信息
 */
export interface Meta {
  eventName: string;
  edition?: string;
  /**
   * 当前赛事涉及的副本列表。数组顺序即副本排列顺序；阶段 phase 必须按此顺序推进（M1S 阶段全 CLEAR 后才能进入 M2S 阶段）。
   *
   * @minItems 1
   */
  dungeons: [Dungeon, ...Dungeon[]];
  /**
   * 预留字段：当前 UI 不渲染；启用前需补 selector / 视图
   */
  boss?: string;
  /**
   * 预留字段：当前 UI 不渲染；启用前需补 selector / 视图
   */
  dataCenter?: string;
  /**
   * ISO 8601 瞬时，需含时区（UTC 用 Z，或 ±HH:MM）；status=upcoming 且未知时用 "-" 占位
   */
  startTime?: string;
  status: "upcoming" | "live" | "ended";
  [k: string]: unknown;
}
/**
 * 单个副本定义（id 用于 phase 拼接，name 用于展示）
 */
export interface Dungeon {
  /**
   * 副本短代码（如 M1S），用于 phase 拼接
   */
  id: string;
  /**
   * 副本完整显示名
   */
  name: string;
}
/**
 * 运营可编辑的站点文案与媒体。主标题/赛事名使用 meta.eventName；导航、列头、交互文案不在 data.json。
 */
export interface Content {
  hero: Hero;
  rules: Rules;
  seo: Seo;
  media: Media;
  sections: Sections;
}
/**
 * 首页英雄区运营文案（主标题使用 meta.eventName，不在此重复）
 */
export interface Hero {
  /**
   * 标题上方眉题
   */
  kicker: string;
  /**
   * 导语
   */
  lead: string;
  primaryCta: Cta;
  secondaryCta: Cta;
}
/**
 * 行动号召按钮（文案 + 目标）
 */
export interface Cta {
  /**
   * 按钮文案
   */
  label: string;
  /**
   * 锚点、站内路径或绝对 URL
   */
  href: string;
}
/**
 * 赛事规则弹窗内容
 */
export interface Rules {
  title: string;
  kicker: string;
  /**
   * @minItems 1
   */
  items: [string, ...string[]];
}
/**
 * 页面 SEO 文案（title 是独立文案，不由 eventName 自动派生）
 */
export interface Seo {
  title: string;
  description: string;
  /**
   * Open Graph 图片路径或绝对 URL
   */
  ogImage?: string;
}
/**
 * 首页媒体资源（站内路径或 CDN URL）
 */
export interface Media {
  /**
   * 首页大屏视频
   */
  heroVideo: string;
  /**
   * 视频加载失败 / 首帧海报
   */
  heroPoster: string;
}
/**
 * 各章节的运营文案；章节 id / 顺序 / 导航标签不在数据中
 */
export interface Sections {
  ranking: Section;
  news: Section;
  sponsors: Section;
  guides: Section;
}
/**
 * 单个章节的运营文案（id、顺序、导航标签由前端 sections 配置决定）
 */
export interface Section {
  kicker: string;
  title: string;
}
/**
 * 一支竞速队伍及其玩家
 */
export interface Team {
  id: string;
  name: string;
  rank: number;
  bossHP: number;
  /**
   * 阶段：多副本为 <副本id>-<阶段>，单副本（绝境）为 <阶段>（不含副本前缀）；阶段语法为 P<正整数> 或 CLEAR
   */
  phase: string;
  region: "JP" | "NA" | "EU" | "OC" | "CN" | "KR";
  /**
   * @minItems 8
   * @maxItems 8
   */
  players: [Player, Player, Player, Player, Player, Player, Player, Player];
  [k: string]: unknown;
}
/**
 * 队伍中的单个玩家
 */
export interface Player {
  job: string;
  role: "tank" | "healer" | "dps";
  stream: string;
  streaming: boolean;
}
/**
 * 单条赛事速报
 */
export interface NewsItem {
  id: string;
  /**
   * ISO 8601 瞬时，必须含时区（UTC 用 Z，或 ±HH:MM）
   */
  time: string;
  text: string;
  urgent: boolean;
  [k: string]: unknown;
}
/**
 * 转播方信息
 */
export interface Broadcaster {
  id: string;
  name: string;
  platform: string;
  url: string;
  note: string;
  [k: string]: unknown;
}
/**
 * 赞助商条目
 */
export interface Sponsor {
  name: string;
  desc: string;
}
