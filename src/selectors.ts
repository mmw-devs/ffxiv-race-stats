import type { Dungeon, Meta } from '../types/race-data'
import { displayPhase, phaseStage } from './utils/phase'
import {
  formatCountdown,
  formatElapsed,
  formatLocalDateTime,
  formatLocalTime,
  resolveStartTime,
} from './utils/time'
import { selectRankingMode } from './domain/status'
import type { DungeonTab } from './domain/dungeon'
import { stageClass } from '../agent-src/shared/stage.mjs'

/** LIVE 徽标是否显示。 */
export function selectIsLive(status: Meta['status']): boolean {
  return status === 'live'
}

/** 页面 folio 统一格式：VOL.<edition> · <page>。 */
export function selectFolio(meta: Pick<Meta, 'edition'>, page: string): string {
  return `VOL.${meta.edition ?? ''} · ${page}`
}

/** 页脚版权年份：优先取赛事开赛年份，未知时回退当前年。 */
export function selectCopyrightYear(meta: Pick<Meta, 'startTime'>): string {
  const start = meta.startTime && meta.startTime !== '-' ? Date.parse(meta.startTime) : NaN
  return String(Number.isNaN(start) ? new Date().getFullYear() : new Date(start).getUTCFullYear())
}

export type RankMedal = 'n1' | 'n2' | 'n3' | ''

/** 前三名奖牌三色（金 n1 / 银 n2 / 铜 n3），其余名次无特殊色。 */
export function selectRankMedal(rank: number): RankMedal {
  if (rank === 1) return 'n1'
  if (rank === 2) return 'n2'
  if (rank === 3) return 'n3'
  return ''
}

export interface RegionView {
  label: string
  className: string
}

/** 区服标签文本 + 配色 class；空值显示 "??" 且不加色。 */
export function selectRegionView(region: string): RegionView {
  const key = (region || '').toLowerCase()
  return {
    label: region || '??',
    className: key ? `rg-${key}` : '',
  }
}

export interface PhaseView {
  label: string
  className: string
}

/** 阶段的展示文本 + CSS class，避免组件各自解释 phase。 */
export function selectPhaseView(
  phase: string,
  dungeons: readonly Dungeon[],
  focusDungeonId: string | null = null
): PhaseView {
  return {
    label: displayPhase(phase, dungeons, focusDungeonId),
    className: stageClass(phaseStage(phase)),
  }
}

/** 选中副本后的列表说明：已通过 / 仍在此层 / 已 CLEAR 等待进入下一层。 */
export function selectDungeonSummary(tab: DungeonTab | null): string | null {
  if (!tab) return null

  const waitingClear = tab.count - tab.inProgress
  const clearNote = waitingClear > 0 ? `（${waitingClear} 队已 CLEAR）` : ''
  return `查看 ${tab.id}：已通过 ${tab.cleared}/${tab.total} · ${tab.count} 队仍在此层${clearNote}`
}

export type TimerKind = 'countdown' | 'elapsed' | 'ended' | 'unknown' | 'waiting'

export interface TimerView {
  kind: TimerKind
  text: string
}

/** 超过这个时长就不再显示秒级倒计时，改成「日期时间 开赛」。 */
const COUNTDOWN_DATE_THRESHOLD_MS = 24 * 60 * 60 * 1000

/**
 * 计时器语义的唯一来源：未开赛倒计时、进行中已开赛时长、已结束“已结束”。
 *
 * 导航与控制台都消费这个视图，只决定排版，不再各自计算时间。
 */
export function selectTimerView(meta: Pick<Meta, 'status' | 'startTime'>, now: number): TimerView {
  if (meta.status === 'ended') return { kind: 'ended', text: '已结束' }

  const start = resolveStartTime(meta.startTime, now)

  if (start.kind === 'unknown') {
    return meta.status === 'upcoming'
      ? { kind: 'unknown', text: '开赛时间待定' }
      : { kind: 'unknown', text: '开赛时间未知' }
  }

  if (meta.status === 'upcoming') {
    if (start.kind === 'future') {
      return start.msUntil > COUNTDOWN_DATE_THRESHOLD_MS
        ? { kind: 'countdown', text: `${formatLocalDateTime(start.start)} 开赛` }
        : { kind: 'countdown', text: `距开赛 ${formatCountdown(start.msUntil)}` }
    }
    // 本地时间已过开赛时刻，但页面数据仍是未开赛：等待用户刷新。
    return { kind: 'waiting', text: '等待开赛' }
  }

  // 进行中：开赛时间在未来（提前开赛）时仍显示倒计时。
  if (start.kind === 'future') {
    return { kind: 'countdown', text: `距开赛 ${formatCountdown(start.msUntil)}` }
  }
  return { kind: 'elapsed', text: formatElapsed(now - start.start.getTime()) }
}

export type SyncTone = 'neutral' | 'accent' | 'error'

export interface SyncLineView {
  text: string
  tone: SyncTone
  actionLabel: string
  actionDisabled: boolean
}

export interface SyncLineInput {
  status: Meta['status']
  startTime?: string
  sync: {
    refreshing: boolean
    lastSyncedAt: number | null
    error: string | null
  }
}

/**
 * 排行榜上方状态行的唯一来源。
 *
 * 负责「未开赛为什么要手动刷新」「已结束为什么不再自动检查」「刷新失败」等
 * 全部文案分支，组件模板只渲染结果。
 */
export function selectSyncLineView(input: SyncLineInput, now: number): SyncLineView {
  const { status, sync } = input
  const action = { actionLabel: '立即刷新', actionDisabled: sync.refreshing }

  if (sync.refreshing) return { text: '正在同步…', tone: 'neutral', ...action }

  if (sync.error !== null) {
    return status === 'live'
      ? { text: '同步失败，正在重试', tone: 'error', ...action }
      : { text: '刷新失败，请稍后重试', tone: 'error', ...action }
  }

  if (status === 'ended') {
    return { text: '赛事已结束 · 已停止自动检查', tone: 'neutral', ...action }
  }

  if (status === 'upcoming') {
    const start = resolveStartTime(input.startTime, now)
    if (sync.lastSyncedAt !== null) {
      return {
        text: `未开赛 · 最近检查 ${formatLocalTime(sync.lastSyncedAt)}`,
        tone: 'neutral',
        ...action,
      }
    }
    if (start.kind === 'passed') {
      return { text: '开赛时间已到 · 请刷新获取比赛状态', tone: 'accent', ...action }
    }
    if (start.kind === 'unknown') {
      return { text: '未开赛 · 开赛时间待定，可手动刷新', tone: 'neutral', ...action }
    }
    return { text: '未开赛 · 开赛后请点「立即刷新」', tone: 'neutral', ...action }
  }

  if (sync.lastSyncedAt !== null) {
    return { text: `已同步 ${formatLocalTime(sync.lastSyncedAt)}`, tone: 'neutral', ...action }
  }
  return { text: '等待首次同步', tone: 'neutral', ...action }
}

export interface RankingBadge {
  label: string
  className: string
}

/** 榜单语义徽标：未开赛「种子序」、已结束「最终成绩」，进行中不显示。 */
export function selectRankingBadge(status: Meta['status']): RankingBadge | null {
  const mode = selectRankingMode(status)
  if (mode === 'seed') return { label: '种子序', className: 'seed' }
  if (mode === 'final') return { label: '最终成绩', className: 'final' }
  return null
}
