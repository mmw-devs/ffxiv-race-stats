import type { Dungeon, Team } from '../../types/race-data'
import { parseStage } from '../../agent-src/shared/stage.mjs'
import { selectTeamProgress } from './team'

/**
 * 副本（frontier）读模型。
 *
 * 数据里 `phase` 只记录「当前打到哪里」，不是历史成绩，因此这里能可靠回答的只有：
 * - 这队当前在哪一层；
 * - 它是否已通过某层（已进入更后面的层，或在该层 CLEAR）；
 * - 它是否仍在该层挑战。
 *
 * 组件不自行 indexOf 副本、不判断 CLEAR，全部从这里取。
 */
export interface TeamDungeonState {
  /** 当前层的副本 id；单副本无前缀时归属唯一副本；无法归属时为 null。 */
  dungeonId: string | null
  /** 当前层在 meta.dungeons 中的下标；无法归属时为 null。 */
  dungeonIndex: number | null
  /** 仅阶段部分（P<n> / CLEAR / 原样）。 */
  stage: string
  isClear: boolean
}

export interface DungeonTab {
  id: string
  name: string
  index: number
  /** 当前层在这一层的队伍数（含已 CLEAR、等待进入下一层的）。 */
  count: number
  /** 已通过这一层的队伍数（进入更后面的层，或在本层 CLEAR）。 */
  cleared: number
  /** 仍在挑战这一层的队伍数（当前层在这一层且未 CLEAR）。 */
  inProgress: number
  /** 全部队伍数（含阶段无法归属的），作为「已通过 X / Y」的分母。 */
  total: number
}

/** 副本 id → 下标；未知或 null 返回 -1。 */
export function resolveDungeonIndex(dungeons: readonly Dungeon[], dungeonId: string | null): number {
  if (dungeonId === null) return -1
  return dungeons.findIndex((dungeon) => dungeon.id === dungeonId)
}

/** 单队当前层状态；单副本（绝境）的无前缀阶段归属唯一副本。 */
export function selectTeamDungeonState(
  team: Pick<Team, 'phase' | 'bossHP'>,
  dungeons: readonly Dungeon[]
): TeamDungeonState {
  const progress = selectTeamProgress(team)
  const isClear = parseStage(progress.stage)?.kind === 'clear'
  let dungeonId = progress.dungeonId
  let index = resolveDungeonIndex(dungeons, dungeonId)

  // 单副本赛事：phase 不带副本前缀（P4 / CLEAR），归属唯一副本。
  if (index === -1 && dungeons.length === 1) {
    dungeonId = dungeons[0]?.id ?? null
    index = dungeonId === null ? -1 : 0
  }

  return {
    dungeonId: index === -1 ? null : dungeonId,
    dungeonIndex: index === -1 ? null : index,
    stage: progress.stage,
    isClear,
  }
}

/**
 * 副本 tab 的计数。
 *
 * 只有多副本赛事才返回 tab；单副本由调用方直接隐藏切换器，
 * 「是否出现副本切换」只有这一个判断点。
 */
export function selectDungeonTabs(teams: readonly Team[], dungeons: readonly Dungeon[]): DungeonTab[] {
  if (dungeons.length <= 1) return []

  const states = teams.map((team) => selectTeamDungeonState(team, dungeons))
  const total = teams.length

  return dungeons.map((dungeon, index) => {
    let count = 0
    let cleared = 0
    let inProgress = 0

    for (const state of states) {
      if (state.dungeonIndex === null) continue

      if (state.dungeonIndex > index || (state.dungeonIndex === index && state.isClear)) {
        cleared++
      }
      if (state.dungeonIndex === index) {
        count++
        if (!state.isClear) inProgress++
      }
    }

    return { id: dungeon.id, name: dungeon.name, index, count, cleared, inProgress, total }
  })
}

/** 按当前层过滤；null 表示「全部」，保留原顺序（排序仍由榜单负责）。 */
export function filterTeamsByDungeon(
  teams: readonly Team[],
  dungeons: readonly Dungeon[],
  dungeonId: string | null
): Team[] {
  if (dungeonId === null) return [...teams]

  const index = resolveDungeonIndex(dungeons, dungeonId)
  if (index === -1) return []

  return teams.filter((team) => selectTeamDungeonState(team, dungeons).dungeonIndex === index)
}
