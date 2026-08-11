/**
 * inspect.js — 悬停检测工具
 * 仅在 localhost:4321?inspect 时由 BaseLayout.astro 条件注入
 * 生产环境（80/443 端口）永不加载
 */
(function () {
  if (window.__pi_inspect_loaded) return;
  window.__pi_inspect_loaded = true;

  // 底部信息栏
  const bar = document.createElement('div');
  bar.id = '__pi_inspect_bar';
  bar.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;z-index:99999;' +
    'background:#1a1a2e;color:#a0ff80;padding:6px 16px;' +
    'font-family:"JetBrains Mono",monospace;font-size:12px;' +
    'pointer-events:none;display:none;border-top:1px solid #333;';
  document.body.appendChild(bar);

  // 构建 CSS 选择器路径
  function selectorPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) {
        seg += '#' + cur.id;
      } else if (cur.className && typeof cur.className === 'string') {
        const cls = cur.className.trim().split(/\s+/).slice(0, 3).join('.');
        if (cls) seg += '.' + cls;
      }
      const parent = cur.parentElement;
      if (parent) {
        const sameTagSiblings = [...parent.children].filter(
          (c) => c.tagName === cur.tagName
        );
        if (sameTagSiblings.length > 1) {
          seg += ':nth-of-type(' + (sameTagSiblings.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  let lastEl = null;

  document.addEventListener(
    'mouseover',
    function (e) {
      if (lastEl === e.target) return;
      if (lastEl) {
        lastEl.style.outline = lastEl.__pi_old_outline || '';
      }
      const el = e.target;
      el.__pi_old_outline = el.style.outline;
      el.style.outline = '1px dashed #ff6b6b';
      lastEl = el;

      const path = selectorPath(el);
      const text = (el.textContent || '').trim().slice(0, 60).replace(/\s+/g, ' ');
      bar.textContent = path + (text ? '  →  "' + text + '"' : '');
      bar.style.display = 'block';
    },
    true
  );

  document.addEventListener(
    'mouseout',
    function (e) {
      // 仅当鼠标真正离开元素时才清除（跳过子元素间的冒泡）
      if (lastEl && !lastEl.contains(e.relatedTarget)) {
        lastEl.style.outline = lastEl.__pi_old_outline || '';
        lastEl = null;
        bar.style.display = 'none';
      }
    },
    true
  );

  // Ctrl+Click 复制选择器到剪贴板
  document.addEventListener(
    'click',
    function (e) {
      if (!e.altKey) return;
      if (!bar.style.display || bar.style.display === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      const text = bar.textContent;
      navigator.clipboard.writeText(text).then(() => {
        bar.style.background = '#1a3a1a';
        bar.textContent = '✓ 已复制: ' + text;
        setTimeout(() => {
          bar.style.background = '#1a1a2e';
          bar.textContent = text;
        }, 800);
      });
    },
    true
  );
})();
