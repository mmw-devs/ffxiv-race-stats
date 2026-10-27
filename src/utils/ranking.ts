import type { Team } from '../../types/race-data'

/**
 * 排名比较器：rank 升序；同 rank（数据异常）时用 id 兜底，保证顺序稳定。
 */
export function compareTeamsByRank(a: Team, b: Team): number {
  return a.rank - b.rank || a.id.localeCompare(b.id)
}

/**
 * 返回按 rank 升序排列的新数组，不修改入参。
 *
 * 数据契约只保证 rank 是 1..n 连续整数，不保证 teams[] 的数组顺序；
 * 展示层不能假设「数组第 0 项就是第 1 名」。
 */
export function sortTeamsByRank(teams: readonly Team[]): Team[] {
  return [...teams].sort(compareTeamsByRank)
}
