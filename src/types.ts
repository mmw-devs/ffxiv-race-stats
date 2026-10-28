import type { RACE_DATA } from '../types/race-data'

// 数据契约的唯一来源是 agent-src/schema/*.json；这里的类型全部由 typegen 生成。
export type { Sponsor } from '../types/race-data'

/** 校验通过后的顶层数据（Content 在迁移期为可选）。 */
export type RaceData = RACE_DATA

/** 直播覆盖统计（由 teams 派生，不属于 data.json）。 */
export interface Coverage {
  totalPlayers: number
  streamingPlayers: number
  teamsWithCoverage: number
}
