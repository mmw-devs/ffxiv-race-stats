import type { Broadcaster, Meta, NewsItem, Team } from '../types/race-data'

/** 赞助商条目（schema 未定义 items，前端约定形状）。 */
export interface Sponsor {
  name: string
  desc: string
}

/** 直播覆盖统计。 */
export interface Coverage {
  totalPlayers: number
  streamingPlayers: number
  teamsWithCoverage: number
}

/**
 * 校验通过后的完整数据结构。
 * 把 `unknown → 具体类型` 的收窄集中在 useRaceData 一处，组件不再各自断言。
 */
export interface RaceData {
  meta: Meta
  teams: Team[]
  news: NewsItem[]
  broadcasters: Broadcaster[]
  notices: string[]
  sponsors: Sponsor[]
}
