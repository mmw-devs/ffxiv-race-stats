import type { Broadcaster } from '../../types/race-data'

/** 控制台只展示前 3 个转播台；这是 UI 展示策略，不是业务事实。 */
export const BROADCAST_PREVIEW_LIMIT = 3

export function selectPreviewBroadcasters(broadcasters: readonly Broadcaster[]): Broadcaster[] {
  return broadcasters.slice(0, BROADCAST_PREVIEW_LIMIT)
}

/** 只允许 # 或 http(s) 进入 href，防止 data 里的 javascript: 被直接渲染。 */
export function selectBroadcasterHref(broadcaster: Pick<Broadcaster, 'url'>): string {
  const url = broadcaster.url
  return url && (url === '#' || /^https?:\/\//.test(url)) ? url : '#'
}
