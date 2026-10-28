// 转播台头像配色与编号规则（此前在 App.vue 与 ConsoleBar.vue 各写了一份，现收敛于此）。

import { pad2 } from '../utils/format'

const BROADCAST_TONES = ['var(--accent)', 'var(--cool)', 'var(--gold)']

export function broadcastTone(index: number): string {
  return BROADCAST_TONES[index % BROADCAST_TONES.length]
}

export function broadcastMonogram(index: number): string {
  return 'B.' + pad2(index + 1)
}
