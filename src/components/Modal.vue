<!-- Modal.vue — 通用弹窗（规则 / 转播台 / 公告），同屏最多一个 -->
<template>
  <Teleport to="body">
    <Transition name="az-modal" :duration="340" @after-leave="onAfterLeave">
      <div v-if="open" class="az-modal" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <div class="az-modal-backdrop" @click="emit('close')"></div>
        <div
          class="az-modal-panel"
          :class="{ 'az-modal-wide': wide }"
          ref="panel"
          tabindex="-1"
          @keydown="onKeydown"
        >
          <div class="az-modal-head">
            <div>
              <p class="az-panel-label">{{ kicker }}</p>
              <h3 :id="titleId">{{ title }}</h3>
            </div>
            <div class="az-modal-head-right">
              <span class="az-folio">{{ folio }}</span>
              <button type="button" class="az-rules-close" :aria-label="'关闭' + title" @click="emit('close')">×</button>
            </div>
          </div>
          <div class="az-modal-body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, onUnmounted, ref } from 'vue'
import { lockPageScroll, unlockPageScroll } from '../utils/scrollLock'

const props = defineProps<{
  open: boolean
  id: string
  title: string
  kicker: string
  folio: string
  wide?: boolean
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const titleId = computed(() => props.id + '-title')
const panel = ref<HTMLElement | null>(null)

// 所有可获得焦点的元素（不包含 tabindex=-1 的容器本身）
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let locked = false

function lockScroll(): void {
  if (locked) return
  locked = true
  lockPageScroll()
}

function unlockScroll(): void {
  if (!locked) return
  locked = false
  unlockPageScroll()
}

function getFocusableElements(): HTMLElement[] {
  if (!panel.value) return []
  return Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.getClientRects().length > 0)
}

/**
 * 弹窗键盘行为：
 * - Esc 关闭（不再依赖 App 的全局 keydown）
 * - Tab / Shift+Tab 在弹窗内循环，避免焦点跑到背景页面
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return

  const focusables = getFocusableElements()
  if (focusables.length === 0) {
    event.preventDefault()
    panel.value?.focus()
    return
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement

  if (event.shiftKey && (active === first || active === panel.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

// 关闭过渡结束再解锁，避免过渡期间背景可滚动；若期间重新打开则不解锁
function onAfterLeave(): void {
  if (!props.open) unlockScroll()
}

// 打开时锁定页面滚动并把焦点移入弹窗（键盘用户可直接 Esc/Enter，不用先 Tab 一圈）；
// 关闭时把焦点归还给触发元素，否则焦点落在 body 上、键盘导航断链。
let previouslyFocused: HTMLElement | null = null
watch(() => props.open, (open) => {
  if (open) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    lockScroll()
    nextTick(() => panel.value?.focus())
  } else {
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus()
    }
    previouslyFocused = null
  }
})
onUnmounted(unlockScroll)
</script>
