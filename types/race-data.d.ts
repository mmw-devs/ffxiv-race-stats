/**
 * 由 scripts/generate-types.mjs 自动生成 — 请勿手动编辑
 * 数据源：agent-src/schema/*.schema.json
 * 重新生成：npm run typegen
 */

/**
 * FFXIV 竞速排名数据顶层结构
 */
export interface RACE_DATA {
  meta: Meta;
  teams: Team[];
  news: NewsItem[];
  broadcasters: Broadcaster[];
  notices: unknown[];
  sponsors: unknown[];
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
  boss?: string;
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
 * 一支竞速队伍及其玩家
 */
export interface Team {
  id: string;
  name?: string;
  rank: number;
  bossHP: number;
  /**
   * 阶段：多副本为 <副本id>-<阶段>，单副本（绝境）为 <阶段>（不含副本前缀）；副本id 必须在 meta.dungeons[] 中，阶段必须在 PHASE_ORDER 白名单内
   */
  phase: string;
  region: "JP" | "NA" | "EU" | "OC" | "CN" | "KR";
  isLive: boolean;
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
  isLive?: boolean;
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
