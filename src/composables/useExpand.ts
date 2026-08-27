/**
 * useExpand.ts
 *
 * 展开态互斥 composable：所有组件共享同一个 ref，
 * 同时间只能有一个模块展开（'ranking' | 'sponsor' | 'notice' | null）。
 *
 * 注意：模块级 ref 是有意设计——多个组件共享同一状态，
 * 替代 Pinia/Vuex 等全局状态库。如需每实例独立状态，应改在函数内创建 ref。
 */

import { ref, type Ref } from 'vue'

export type ExpandKey = 'ranking' | 'sponsor' | 'notice' | null

const expandedId: Ref<ExpandKey> = ref<ExpandKey>(null)

export function useExpand(): Ref<ExpandKey> {
  return expandedId
}