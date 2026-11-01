import type { Meta } from '../../types/race-data'

/**
 * 自动检查策略的唯一来源。
 *
 * 只有比赛进行中才自动检查；未开赛/已结束都不请求（由运营提示手动刷新）。
 * 失败后退避只影响「下一次检查」，不影响页面已展示的数据。
 */
export const LIVE_REFRESH_INTERVAL_MS = 60_000
export const MAX_REFRESH_INTERVAL_MS = 300_000

/**
 * 下一次自动检查的间隔。
 *
 * @param status 赛事状态
 * @param failures 连续失败次数（成功后调用方归零）
 * @returns 进行中返回毫秒数；未开赛/已结束返回 null（不自动检查）
 */
export function autoRefreshDelay(status: Meta['status'], failures: number): number | null {
  if (status !== 'live') return null

  const safeFailures = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0
  const delay = LIVE_REFRESH_INTERVAL_MS * 2 ** Math.min(safeFailures, 4)
  return Math.min(delay, MAX_REFRESH_INTERVAL_MS)
}

/**
 * 页面重新可见时是否需要立刻补一次检查。
 *
 * 只在进行中生效；从未成功检查过（null）视为过期。
 */
export function isRefreshStale(
  lastSyncedAt: number | null,
  now: number,
  status: Meta['status']
): boolean {
  if (status !== 'live') return false
  if (lastSyncedAt === null) return true
  return now - lastSyncedAt >= LIVE_REFRESH_INTERVAL_MS
}
