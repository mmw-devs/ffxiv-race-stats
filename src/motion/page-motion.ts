/**
 * page-motion.ts — 页面动效层（导航高度、阅读进度、hero 视差、scrollspy、离屏暂停）。
 *
 * 从 BaseLayout.astro 的内联脚本原样迁出；行为不变，先让布局文件只保留结构与样式。
 * 统一由「一个 scroll 监听 + 每帧一次 rAF」驱动；每帧先读尺寸再写样式，避免滚动中反复强制重排。
 */
interface NavLink {
  el: Element
  sec: HTMLElement | null
  top: number
  id: string
}

interface WebkitStyle extends CSSStyleDeclaration {
  webkitBackdropFilter?: string
}

export function initPageMotion(): void {
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const root = document.documentElement;
      const progress = document.getElementById('scrollProgress');

      let shell: Element | null = null;
      let shot: HTMLElement | null = null;
      let video: HTMLVideoElement | null = null;
      let track: Element | null = null;
      let links: NavLink[] | null = null;
      let heroInView: boolean | null = null;   // 只在状态变化时切换播放，不每帧调 play/pause

      // ── 导航高度 ──
      let navH = 0;
      function setNavH() {
        const nav = document.getElementById('masthead');
        if (!nav) return;
        const h = nav.offsetHeight;
        if (h && h !== navH) { navH = h; root.style.setProperty('--nav-h', h + 'px'); }
      }
      setNavH();
      window.addEventListener('resize', setNavH, { passive: true });
      const navObserver = new MutationObserver(function () {
        if (document.getElementById('masthead')) { setNavH(); navObserver.disconnect(); }
      });
      navObserver.observe(document.body, { childList: true, subtree: true });

      // ── DOM 懒查询（元素由 Vue 客户端渲染）──
      function cache() {
        if (!shell) shell = document.querySelector('.az-hero-stage');
        if (!shot) shot = document.querySelector<HTMLElement>('.az-hero-shot');
        if (!track) track = document.querySelector('.az-notices-track');
        if (!links) {
          links = [];
          const as = document.querySelectorAll('.az-nav-links a');
          for (let i = 0; i < as.length; i++) {
            links.push({ el: as[i], sec: null, top: 0, id: (as[i].getAttribute('href') || '').replace(/^#/, '') });
          }
        }
      }

      // ── 章节位置：只在尺寸/内容变化时重算，滚动帧内不再读 offsetTop ──
      function measure() {
        cache();
        if (!links) return;
        for (let i = 0; i < links.length; i++) {
          const sec = document.getElementById(links[i].id);
          links[i].sec = sec;
          links[i].top = sec ? sec.offsetTop : 0;
        }
      }

      let pending = false;
      function schedule() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(paint);
      }

      function toggleHeroMedia(play: boolean) {
        if (!video) video = document.querySelector<HTMLVideoElement>('.az-hero-shot');
        if (video && typeof video.play === 'function') {
          if (play && !document.hidden) {
            const pr = video.play();
            if (pr && pr.catch) pr.catch(function () {});
          } else {
            video.pause();
          }
        }
        // 用 class 而不是行内 style：否则会盖掉 CSS 里「悬停暂停」的规则
        if (track) track.classList.toggle('is-paused', !play);
      }

      // 毛玻璃面板（.az-notices）在离屏期间 resize 后，回到视口时 backdrop-filter
      // 可能采样到陈旧的视频背景，出现「错位矩形」。先置 none 渲染一帧，再恢复，
      // 强制浏览器重新采样 backdrop（跨帧切换比同步切换更可靠，能确保真正重光栅化）。
      function refreshHeroBackdrops() {
        const panels = document.querySelectorAll<HTMLElement>('.az-notices');
        for (let i = 0; i < panels.length; i++) {
          panels[i].style.backdropFilter = 'none';
          (panels[i].style as WebkitStyle).webkitBackdropFilter = 'none';
        }
        requestAnimationFrame(function () {
          for (let j = 0; j < panels.length; j++) {
            panels[j].style.backdropFilter = '';
            (panels[j].style as WebkitStyle).webkitBackdropFilter = '';
          }
        });
      }

      function paint() {
        pending = false;
        const el = document.scrollingElement || document.documentElement;
        const y = el.scrollTop;
        const vh = window.innerHeight || 0;

        // ① 只读：本帧需要的尺寸一次性读完
        const docH = el.scrollHeight;
        const heroRect = shell ? shell.getBoundingClientRect() : null;

        // ② 只写：阅读进度
        if (progress) {
          const max = (docH - vh) || 1;
          progress.style.setProperty('--progress', Math.max(0, Math.min(1, y / max)).toFixed(4));
        }

        // ③ hero：视差 + 离屏暂停（视频解码很贵，离屏停掉，滚动才跟手）
        if (heroRect) {
          const inView = heroRect.bottom > -80 && heroRect.top < vh + 80;
          if (shot) {
            if (inView && !reduced) {
              const rel = (heroRect.top + heroRect.height / 2) - vh / 2;
              shot.style.transform = 'translate3d(0,' + (rel * -0.04).toFixed(1) + 'px,0) scale(1.06)';
            } else {
              // 离屏 / reduced-motion 时复位 transform：否则视频带着最后一次视差位移
              // 残留在合成层，resize 后再滚回大屏，公告面板 backdrop-filter 会采到错位底纹
              shot.style.transform = '';
            }
          }
          if (!video) video = document.querySelector<HTMLVideoElement>('.az-hero-shot');
          if (heroInView !== inView) {
            heroInView = inView;
            if (video) toggleHeroMedia(inView);
            // 回到大屏时强制重挂毛玻璃 backdrop-filter，修复 resize 后的错位矩形
            if (inView) refreshHeroBackdrops();
          }
        }

        // ④ nav 高亮：位置来自缓存，滚动帧内零布局读取
        if (links && links.length) {
          const line = y + 180;
          const nearBottom = vh + y >= docH - 90;
          let cur = null;
          for (let i = 0; i < links.length; i++) {
            if (links[i].sec && links[i].top <= line) cur = links[i];
          }
          if (nearBottom) cur = links[links.length - 1];
          for (let j = 0; j < links.length; j++) {
            const on = links[j] === cur;
            links[j].el.classList.toggle('is-active', on);
            if (on) links[j].el.setAttribute('aria-current', 'true');
            else links[j].el.removeAttribute('aria-current');
          }
        }
      }

      let measurePending = false;
      function scheduleMeasure() {
        if (measurePending) return;
        measurePending = true;
        requestAnimationFrame(function () { measurePending = false; measure(); schedule(); });
      }

      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', scheduleMeasure, { passive: true });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) toggleHeroMedia(false);
        else if (heroInView) toggleHeroMedia(true);
      });
      // 数据渲染完成 / 展开收起后重算章节位置
      new MutationObserver(scheduleMeasure).observe(document.body, { childList: true, subtree: true });

      measure();
      paint();
}
