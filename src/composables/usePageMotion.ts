import { onMounted, onUnmounted, watch } from 'vue'
import { useScrollY } from './useScroll'
import { prefersReducedMotion } from '../utils/motion'

interface NavLink {
  el: Element
  sec: HTMLElement | null
  top: number
  id: string
}

interface WebkitStyle extends CSSStyleDeclaration {
  webkitBackdropFilter?: string
}

/**
 * 页面动效层：导航高度、阅读进度、hero 视差、scrollspy、离屏暂停。
 *
 * 从 BaseLayout 的内联脚本迁入，由 PageView 拥有生命周期；
 * 滚动位置复用 useScroll 的共享 rAF，不再额外注册 scroll 监听。
 */
export function usePageMotion(): void {
  const scrollY = useScrollY()

  let reduced = false
  let shell: Element | null = null
  let shot: HTMLElement | null = null
  let video: HTMLVideoElement | null = null
  let track: Element | null = null
  let progressBar: HTMLElement | null = null
  let links: NavLink[] = []
  let heroInView: boolean | null = null
  let navH = 0
  let measurePending = false
  let measureRaf = 0
  let stopScroll: (() => void) | null = null
  let navResize: ResizeObserver | null = null
  let bodyObserver: MutationObserver | null = null

  function setNavH(): void {
    const nav = document.getElementById('masthead')
    if (!nav) return
    const height = nav.offsetHeight
    if (height && height !== navH) {
      navH = height
      document.documentElement.style.setProperty('--nav-h', `${height}px`)
    }
  }

  function measure(): void {
    for (const link of links) {
      const section = document.getElementById(link.id)
      link.sec = section
      link.top = section ? section.offsetTop : 0
    }
  }

  function toggleHeroMedia(play: boolean): void {
    if (!video) video = document.querySelector<HTMLVideoElement>('.az-hero-shot')
    if (video && typeof video.play === 'function') {
      if (play && !document.hidden) {
        const result = video.play()
        if (result && result.catch) result.catch(() => {})
      } else {
        video.pause()
      }
    }
    // 用 class 而不是行内 style：否则会盖掉 CSS 里「悬停暂停」的规则
    if (track) track.classList.toggle('is-paused', !play)
  }

  // 毛玻璃面板在离屏 resize 后可能采样到陈旧视频背景；强制重新采样。
  function refreshHeroBackdrops(): void {
    const panels = document.querySelectorAll<HTMLElement>('.az-notices')
    for (let i = 0; i < panels.length; i++) {
      panels[i].style.backdropFilter = 'none'
      ;(panels[i].style as WebkitStyle).webkitBackdropFilter = 'none'
    }
    requestAnimationFrame(() => {
      for (let i = 0; i < panels.length; i++) {
        panels[i].style.backdropFilter = ''
        ;(panels[i].style as WebkitStyle).webkitBackdropFilter = ''
      }
    })
  }

  function paint(): void {
    const y = scrollY.value
    const el = document.scrollingElement || document.documentElement
    const vh = window.innerHeight || 0
    const docH = el.scrollHeight
    const heroRect = shell ? shell.getBoundingClientRect() : null

    const progress = progressBar
    if (progress) {
      const max = (docH - vh) || 1
      progress.style.setProperty('--progress', Math.max(0, Math.min(1, y / max)).toFixed(4))
    }

    if (heroRect) {
      const inView = heroRect.bottom > -80 && heroRect.top < vh + 80
      if (shot) {
        if (inView && !reduced) {
          const rel = (heroRect.top + heroRect.height / 2) - vh / 2
          shot.style.transform = `translate3d(0,${(rel * -0.04).toFixed(1)}px,0) scale(1.06)`
        } else {
          shot.style.transform = ''
        }
      }
      if (heroInView !== inView) {
        heroInView = inView
        toggleHeroMedia(inView)
        if (inView) refreshHeroBackdrops()
      }
    }

    if (links.length > 0) {
      const line = y + 180
      const nearBottom = vh + y >= docH - 90
      let current: NavLink | null = null
      for (const link of links) {
        if (link.sec && link.top <= line) current = link
      }
      if (nearBottom) current = links[links.length - 1]
      for (const link of links) {
        const active = link === current
        link.el.classList.toggle('is-active', active)
        if (active) link.el.setAttribute('aria-current', 'true')
        else link.el.removeAttribute('aria-current')
      }
    }
  }

  function scheduleMeasure(): void {
    if (measurePending) return
    measurePending = true
    measureRaf = requestAnimationFrame(() => {
      measurePending = false
      measure()
      paint()
    })
  }

  function onResize(): void {
    setNavH()
    scheduleMeasure()
    refreshHeroBackdrops()
  }

  function onVisibilityChange(): void {
    if (document.hidden) toggleHeroMedia(false)
    else if (heroInView) toggleHeroMedia(true)
  }

  onMounted(() => {
    reduced = prefersReducedMotion()
    shell = document.querySelector('.az-hero-stage')
    shot = document.querySelector<HTMLElement>('.az-hero-shot')
    video = document.querySelector<HTMLVideoElement>('.az-hero-shot')
    track = document.querySelector('.az-notices-track')
    progressBar = document.getElementById('scrollProgress')
    links = Array.from(document.querySelectorAll('.az-nav-links a')).map((el) => ({
      el,
      sec: null,
      top: 0,
      id: (el.getAttribute('href') || '').replace(/^#/, ''),
    }))

    setNavH()
    if ('ResizeObserver' in window) {
      navResize = new ResizeObserver(setNavH)
      const nav = document.getElementById('masthead')
      if (nav) navResize.observe(nav)
    }
    measure()
    paint()

    stopScroll = watch(scrollY, paint)
    window.addEventListener('resize', onResize, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    bodyObserver = new MutationObserver(scheduleMeasure)
    bodyObserver.observe(document.body, { childList: true, subtree: true })
  })

  onUnmounted(() => {
    stopScroll?.()
    stopScroll = null
    navResize?.disconnect()
    navResize = null
    bodyObserver?.disconnect()
    bodyObserver = null
    video?.pause()
    video = null
    if (measureRaf) cancelAnimationFrame(measureRaf)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
