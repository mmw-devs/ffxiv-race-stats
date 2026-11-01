import type { Player, Team } from '../../types/race-data'
import { isPlayerLive } from './team'

/**
 * 名册分组的唯一来源。
 *
 * 榜单行与详情弹窗都消费这里的分组与顺序，组件不再硬编码「2T / 2H / 4DPS」的
 * 位置或间隔。运行时 validator 只保证 role 是字符串（值域由 ops CI 负责），
 * 因此未知 role 归入「其他」，不丢人、不崩。
 */
export type RosterRole = 'tank' | 'healer' | 'dps' | 'other'

export interface RosterGroup {
  role: RosterRole
  label: string
  players: Player[]
}

const ROLE_ORDER: readonly RosterRole[] = ['tank', 'healer', 'dps', 'other']

const ROLE_LABELS: Record<RosterRole, string> = {
  tank: '坦克',
  healer: '治疗',
  dps: '输出',
  other: '其他',
}

function isKnownRole(role: string): role is Exclude<RosterRole, 'other'> {
  return role === 'tank' || role === 'healer' || role === 'dps'
}

/** 按 坦克 → 治疗 → 输出 → 其他 分组；组内保持数据原顺序，空组不返回。 */
export function selectTeamRoster(players: readonly Player[]): RosterGroup[] {
  const buckets: Record<RosterRole, Player[]> = {
    tank: [],
    healer: [],
    dps: [],
    other: [],
  }

  for (const player of players) {
    const role: RosterRole = isKnownRole(player.role) ? player.role : 'other'
    buckets[role].push(player)
  }

  return ROLE_ORDER.filter((role) => buckets[role].length > 0).map((role) => ({
    role,
    label: ROLE_LABELS[role],
    players: buckets[role],
  }))
}

export interface LiveStream {
  job: string
  role: Player['role']
  url: string
}

/** 可直接打开的直播视角；过滤掉「标记在播但链接为 #」的坏数据。 */
export function selectLiveStreams(team: Pick<Team, 'players'>): LiveStream[] {
  return team.players.filter(isPlayerLive).map((player) => ({
    job: player.job,
    role: player.role,
    url: player.stream,
  }))
}
