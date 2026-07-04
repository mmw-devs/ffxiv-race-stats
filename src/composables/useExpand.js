// 展开态互斥：所有组件共享同一个 ref
import { ref } from 'vue'
const expandedId = ref(null) // 'ranking' | 'sponsor' | 'notice' | null
export function useExpand() { return expandedId }
