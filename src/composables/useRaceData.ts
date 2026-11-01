import { onUnmounted, reactive, ref, type Ref } from 'vue'
import { parseRaceData } from '../utils/parseRaceData'
import { DATA_PUBLIC_PATH } from '../../shared/data-path.mjs'
import type { RaceData } from '../types'

export type RaceDataState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: RaceData }

export type RefreshResult = 'updated' | 'unchanged' | 'failed' | 'skipped'

export interface RaceSyncState {
  /** 是否正在静默刷新（不影响已展示的数据） */
  refreshing: boolean
  /** 最近一次成功检查（200 或 304）的时间戳 */
  lastSyncedAt: number | null
  /** 最近一次由用户触发/自动触发的 refresh 成功时间；首屏 load 不写入 */
  lastManualAt: number | null
  /** 最近一次刷新失败原因；成功后清空 */
  error: string | null
}

export interface UseRaceDataReturn {
  state: Ref<RaceDataState>
  sync: RaceSyncState
  /** 拉取并校验数据；返回是否成功应用了本次结果（被新请求取代 / 卸载时返回 false） */
  load: () => Promise<boolean>
  /** 静默刷新：绝不把页面切到 loading/error；失败保留旧数据 */
  refresh: () => Promise<RefreshResult>
}

type Snapshot = { kind: 'unchanged' } | { kind: 'data'; data: RaceData }

/**
 * data.json 的取数 / 解析 / 状态机。
 *
 * - 首屏与错误重试走 load()，会进入 loading / error 状态；
 * - 进行中的静默刷新走 refresh()，只更新 data 与 sync，不打断页面；
 * - 用 AbortController + 递增 requestId 防止「重试时旧请求后到、覆盖新数据」；
 * - ETag 负责 304 快路径，内容签名负责「服务器不回 ETag 或忽略条件请求」时仍能判断变化。
 */
export function useRaceData(): UseRaceDataReturn {
  const state = ref<RaceDataState>({ status: 'loading' })
  const sync = reactive<RaceSyncState>({
    refreshing: false,
    lastSyncedAt: null,
    lastManualAt: null,
    error: null,
  })

  let controller: AbortController | null = null
  let requestId = 0
  let disposed = false
  let inFlight = false
  let etag: string | null = null
  let signature: string | null = null

  async function requestSnapshot(signal: AbortSignal, conditional: boolean): Promise<Snapshot> {
    const headers: Record<string, string> = {}
    if (conditional && etag !== null) headers['If-None-Match'] = etag

    const response = await fetch(DATA_PUBLIC_PATH, {
      signal,
      cache: 'no-store',
      headers,
    })

    const nextEtag = response.headers.get('etag')
    // 304 的 response.ok 为 false，必须先判断状态码
    if (response.status === 304) {
      if (nextEtag !== null) etag = nextEtag
      return { kind: 'unchanged' }
    }
    if (!response.ok) throw new Error('加载失败: HTTP ' + response.status)

    const raw: unknown = await response.json()
    const parsed = parseRaceData(raw)
    if (!parsed.ok) throw new Error('数据形状校验失败: ' + parsed.errors.join('；'))

    // 服务器不再返回 ETag 时清空，避免下一次拿旧 ETag 换回错误 304。
    etag = nextEtag

    return { kind: 'data', data: parsed.data }
  }

  /** 内容签名去抖：服务器忽略 ETag 时，内容没变也不触发重渲染。 */
  function applyData(data: RaceData): boolean {
    const next = JSON.stringify(data)
    if (next === signature) return false
    signature = next
    state.value = { status: 'ready', data }
    return true
  }

  async function load(): Promise<boolean> {
    const id = ++requestId
    controller?.abort()
    const current = new AbortController()
    controller = current

    state.value = { status: 'loading' }
    sync.lastManualAt = null

    try {
      const result = await requestSnapshot(current.signal, false)
      if (disposed || id !== requestId) return false

      if (result.kind === 'unchanged') {
        // 首屏请求不带 If-None-Match，正常不会 304；若发生说明本地无可复用数据。
        throw new Error('数据未变更但本地无可用数据，请重试')
      }

      signature = JSON.stringify(result.data)
      state.value = { status: 'ready', data: result.data }
      sync.lastSyncedAt = Date.now()
      sync.error = null
      return true
    } catch (err) {
      if (current.signal.aborted || disposed || id !== requestId) return false
      console.error('数据加载失败:', err)
      const message = err instanceof Error && err.message ? err.message : '未知错误，请稍后重试'
      state.value = { status: 'error', message }
      return false
    } finally {
      if (controller === current) controller = null
    }
  }

  async function refresh(): Promise<RefreshResult> {
    if (disposed || state.value.status !== 'ready') return 'skipped'
    if (inFlight) return 'skipped'

    inFlight = true
    sync.refreshing = true
    const current = new AbortController()
    controller = current

    try {
      const result = await requestSnapshot(current.signal, true)
      if (disposed) return 'skipped'

      if (result.kind === 'unchanged') {
        sync.lastSyncedAt = Date.now()
        sync.lastManualAt = sync.lastSyncedAt
        sync.error = null
        return 'unchanged'
      }

      const changed = applyData(result.data)
      sync.lastSyncedAt = Date.now()
      sync.lastManualAt = sync.lastSyncedAt
      sync.error = null
      return changed ? 'updated' : 'unchanged'
    } catch (err) {
      if (current.signal.aborted || disposed) return 'skipped'
      console.warn('数据同步失败:', err)
      sync.error = err instanceof Error && err.message ? err.message : '未知错误，请稍后重试'
      return 'failed'
    } finally {
      if (controller === current) controller = null
      inFlight = false
      sync.refreshing = false
    }
  }

  onUnmounted(() => {
    disposed = true
    requestId++
    controller?.abort()
    controller = null
  })

  return { state, sync, load, refresh }
}
