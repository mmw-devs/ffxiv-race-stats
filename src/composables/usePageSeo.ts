import { toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { Seo } from '../../types/race-data'

function upsertMeta(attr: 'name' | 'property', key: string, value: string | undefined): void {
  if (typeof document === 'undefined') return
  const selector = `meta[${attr}="${key}"]`
  const existing = document.head.querySelector<HTMLMetaElement>(selector)
  if (!value) {
    existing?.remove()
    return
  }
  const el = existing ?? document.createElement('meta')
  if (!existing) {
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', value)
}

/**
 * 把 data.json 的 content.seo 写到文档 head。
 *
 * ⚠️ 当前站点是静态 Astro 输出 + 客户端取数，这里只能保证运行后标题/描述正确，
 * 首屏 HTML 仍是 BaseLayout 的静态值。若 SEO 要求爬虫可见，需要改为构建期取数或 SSR。
 */
export function usePageSeo(seo: MaybeRefOrGetter<Seo | undefined>): void {
  if (typeof document === 'undefined') return

  const apply = (): void => {
    const value = toValue(seo)
    // 数据尚未加载时保持 BaseLayout 静态 head；加载完成后再应用 content.seo。
    if (!value) return
    document.title = value.title
    upsertMeta('name', 'description', value.description)
    upsertMeta('property', 'og:title', value.title)
    upsertMeta('property', 'og:description', value.description)
    upsertMeta('property', 'og:image', value.ogImage)
  }

  apply()
  watch(() => toValue(seo), apply)
}
