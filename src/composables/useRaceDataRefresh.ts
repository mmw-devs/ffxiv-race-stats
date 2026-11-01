import { onMounted, onUnmounted, watch } from 'vue'
import { autoRefreshDelay, isRefreshStale } from '../domain/refresh'
import type { Meta } from '../../types/race-data'
import type { RaceSyncState, RefreshResult } from './useRaceData'

interface Options {
  /** 当前赛事状态；数据未就绪时返回 null */
  status: () => Meta['status'] | null
  ready: () => boolean
  sync: RaceSyncState
  refresh: () => Promise<RefreshResult>
}

/**
 * 自动同步调度器：只决定「什么时候 refresh」，不碰网络与状态替换。
 *
 * - 进行中按 60 秒；未开赛/已结束完全不启动定时器
 * - 页面隐藏时清掉定时器；切回可见且距上次成功检查超过基础间隔时立即补一次
 * - 连续失败按 1/2/4/5 分钟退避；成功一次归零
 * - 定时器只在「数据就绪且状态为进行中」时存在，状态切换会重新决策
 */
export function useRaceDataRefresh(options: Options): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let failures = 0
  let disposed = false

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function plan(): void {
    clearTimer()
    if (disposed || !options.ready()) return

    const status = options.status()
    if (status === null) return

    const delay = autoRefreshDelay(status, failures)
    if (delay === null) return
    timer = setTimeout(run, delay)
  }

  async function run(): Promise<void> {
    timer = null
    if (disposed || !options.ready()) return

    const status = options.status()
    if (status !== 'live') {
      plan()
      return
    }
    if (typeof document !== 'undefined' && document.hidden) {
      // 可见性回调会决定是否补一次
      return
    }

    const result = await options.refresh()
    failures = result === 'failed' ? failures + 1 : 0
    plan()
  }

  function onVisibilityChange(): void {
    if (typeof document === 'undefined') return
    if (document.hidden) {
      clearTimer()
      return
    }

    const status = options.status()
    const stale =
      status === 'live' &&
      failures === 0 &&
      isRefreshStale(options.sync.lastSyncedAt, Date.now(), status)

    if (stale) void run()
    else plan()
  }

  watch(
    () => [options.ready(), options.status()] as const,
    () => {
      failures = 0
      plan()
    },
    { immediate: true }
  )

  onMounted(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    plan()
  })

  onUnmounted(() => {
    disposed = true
    clearTimer()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  })
}
