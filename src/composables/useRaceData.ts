import { onUnmounted, ref, type Ref } from 'vue'
import { parseRaceData } from '../utils/parseRaceData'
import { DATA_PUBLIC_PATH } from '../../shared/data-path.mjs'
import type { RaceData } from '../types'

export type RaceDataState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: RaceData }

export interface UseRaceDataReturn {
  state: Ref<RaceDataState>
  /** 拉取并校验数据；返回是否成功应用了本次结果（被新请求取代 / 卸载时返回 false） */
  load: () => Promise<boolean>
}

/**
 * data.json 的取数 / 解析 / 状态机。
 *
 * - 用 AbortController + 递增 requestId 防止「重试时旧请求后到、覆盖新数据」
 * - 组件卸载时中止在途请求
 * - 校验失败和网络错误都收敛为 error 状态，由 App 渲染错误态
 */
export function useRaceData(): UseRaceDataReturn {
  const state = ref<RaceDataState>({ status: 'loading' })

  let controller: AbortController | null = null
  let requestId = 0
  let disposed = false

  async function load(): Promise<boolean> {
    const id = ++requestId
    controller?.abort()
    const current = new AbortController()
    controller = current

    state.value = { status: 'loading' }

    try {
      const response = await fetch(DATA_PUBLIC_PATH, { signal: current.signal })
      if (!response.ok) throw new Error('加载失败: HTTP ' + response.status)

      const raw: unknown = await response.json()
      const parsed = parseRaceData(raw)
      if (!parsed.ok) throw new Error('数据形状校验失败: ' + parsed.errors.join('；'))
      if (disposed || id !== requestId) return false

      state.value = { status: 'ready', data: parsed.data }
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

  onUnmounted(() => {
    disposed = true
    requestId++
    controller?.abort()
    controller = null
  })

  return { state, load }
}
