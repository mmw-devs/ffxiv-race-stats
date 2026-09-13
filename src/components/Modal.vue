<!-- Modal.vue — 通用弹窗（规则 / 转播台 / 公告），同屏最多一个 -->
<template>
  <Teleport to="body">
    <Transition name="az-modal" :duration="340" @after-leave="unlockScroll">
      <div v-if="open" class="az-modal" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <div class="az-modal-backdrop" @click="emit('close')"></div>
        <div class="az-modal-panel" :class="{ 'az-modal-wide': wide }" ref="panel" tabindex="-1">
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

function lockScroll(): void {
  const sbw = window.innerWidth - document.documentElement.clientWidth
  document.documentElement.style.paddingRight = (sbw > 0 ? sbw : 0) + 'px'
  document.documentElement.style.overflow = 'hidden'
}
function unlockScroll(): void {
  document.documentElement.style.overflow = ''
  document.documentElement.style.paddingRight = ''
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
