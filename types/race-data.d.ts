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
  dungeon?: string;
  boss?: string;
  dataCenter?: string;
  /**
   * ISO 8601 格式
   */
  startTime?: string;
  status: "upcoming" | "live" | "ended";
  [k: string]: unknown;
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
   * 必须在 PHASE_ORDER 白名单内（值域校验由 validate-data.js 交叉校验）
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
   * 格式 HH:MM:SS
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
