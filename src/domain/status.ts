import type { Meta } from '../../types/race-data'

/**
 * 榜单语义的唯一判断点。
 *
 * - 未开赛：名次是种子序，不是成绩；
 * - 进行中：名次是实时名次；
 * - 已结束：名次是最终名次。
 *
 * 组件只消费这个模式，不再各自写 `status === 'upcoming'`。
 */
export type RankingMode = 'seed' | 'live' | 'final'

export function selectRankingMode(status: Meta['status']): RankingMode {
  if (status === 'upcoming') return 'seed'
  if (status === 'ended') return 'final'
  return 'live'
}
