import { onUnmounted, ref, type Ref } from 'vue'
import { validateRaceData } from '../utils/validateRaceData'
import { DATA_PUBLIC_PATH } from '../../shared/data-path.mjs'
import type { Broadcaster, Content, Meta, NewsItem, Team } from '../../types/race-data'
import type { RaceData, Sponsor } from '../types'

export interface UseRaceDataReturn {
  meta: Ref<Meta>
  /** 运营文案；迁移期可能缺失 */
  content: Ref<Content | undefined>
  teams: Ref<Team[]>
  news: Ref<NewsItem[]>
  broadcasters: Ref<Broadcaster[]>
  notices: Ref<string[]>
  sponsors: Ref<Sponsor[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 拉取并校验数据；返回是否成功应用了本次结果（被新请求取代 / 卸载时返回 false） */
  load: () => Promise<boolean>
}

/**
 * data.json 的取数 / 校验 / 错误态。
 *
 * - 用 AbortController + 递增 requestId 防止「重试时旧请求后到、覆盖新数据」
 * - 组件卸载时中止在途请求
 * - 校验失败和网络错误都收敛为 error 文案，由 App 渲染错误态
 */
export function useRaceData(): UseRaceDataReturn {
  const meta = ref<Meta>({} as Meta)
  const content = ref<Content | undefined>(undefined)
  const teams = ref<Team[]>([])
  const news = ref<NewsItem[]>([])
  const broadcasters = ref<Broadcaster[]>([])
  const notices = ref<string[]>([])
  const sponsors = ref<Sponsor[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)

  let controller: AbortController | null = null
  let requestId = 0
  let disposed = false

  async function load(): Promise<boolean> {
    const id = ++requestId
    controller?.abort()
    const current = new AbortController()
    controller = current

    loading.value = true
    error.value = null

    try {
      const response = await fetch(DATA_PUBLIC_PATH, { signal: current.signal })
      if (!response.ok) throw new Error('加载失败: HTTP ' + response.status)

      const raw: unknown = await response.json()
      const check = validateRaceData(raw)
      if (!check.ok) throw new Error('数据形状校验失败: ' + check.errors.join('；'))
      if (disposed || id !== requestId) return false

      const data = raw as RaceData
      meta.value = data.meta
      content.value = data.content
      teams.value = data.teams
      news.value = data.news
      broadcasters.value = data.broadcasters
      notices.value = data.notices
      sponsors.value = data.sponsors
      return true
    } catch (err) {
      if (current.signal.aborted || disposed || id !== requestId) return false
      console.error('数据加载失败:', err)
      error.value = err instanceof Error && err.message ? err.message : '未知错误，请稍后重试'
      return false
    } finally {
      if (id === requestId && !disposed) loading.value = false
      if (controller === current) controller = null
    }
  }

  onUnmounted(() => {
    disposed = true
    requestId++
    controller?.abort()
    controller = null
  })

  return { meta, content, teams, news, broadcasters, notices, sponsors, loading, error, load }
}
