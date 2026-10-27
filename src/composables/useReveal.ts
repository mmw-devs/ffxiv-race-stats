import { onUnmounted } from 'vue'
import { prefersReducedMotion } from '../utils/motion'

/**
 * 滚动入场：给 `.reveal` 元素注册 IntersectionObserver，进入视口后加 `.in-view`。
 *
 * 注意：
 * - 可重复调用（重载数据 / HMR）：先断开上一次观察，避免 observer 堆叠
 * - 组件卸载时断开，避免持有已卸载的 DOM
 */
export function useReveal(): { setup: () => void; teardown: () => void } {
  let observer: IntersectionObserver | null = null

  function setup(): void {
    observer?.disconnect()
    observer = null

    const elements = document.querySelectorAll<HTMLElement>('.reveal')
    if (elements.length === 0) return

    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      elements.forEach((el) => el.classList.add('in-view'))
      return
    }

    // threshold 用 0.01 + 底部 -60px 内缩：
    // ① 比视口还高的区块（展开后的排名表/速报列表）也能触发，不会因比例达不到阈值而永远不可见
    // ② 元素真正进入视口 60px 后再入场，避免“刚露个边就闪一下”
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('in-view')
          io.unobserve(entry.target)
        })
      },
      { threshold: 0.01, rootMargin: '0px 0px -60px 0px' }
    )

    elements.forEach((el, index) => {
      el.style.setProperty('--reveal-delay', `${(index % 4) * 90}ms`)
      io.observe(el)
    })
    observer = io
  }

  function teardown(): void {
    observer?.disconnect()
    observer = null
  }

  onUnmounted(teardown)
  return { setup, teardown }
}
