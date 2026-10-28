// 页面滚动锁：Modal 实例共享，避免多个弹窗交接时提前恢复滚动。
let depth = 0
let previousOverflow = ''
let previousPaddingRight = ''

export function lockPageScroll(): void {
  if (depth++ > 0) return

  previousOverflow = document.documentElement.style.overflow
  previousPaddingRight = document.documentElement.style.paddingRight
  const sbw = window.innerWidth - document.documentElement.clientWidth
  if (sbw > 0) document.documentElement.style.paddingRight = sbw + 'px'
  document.documentElement.style.overflow = 'hidden'
}

export function unlockPageScroll(): void {
  if (depth === 0) return
  depth--
  if (depth > 0) return

  document.documentElement.style.overflow = previousOverflow
  document.documentElement.style.paddingRight = previousPaddingRight
}
