// 转播台头像配色与编号规则（此前在 App.vue 与 ConsoleBar.vue 各写了一份，现收敛于此）。

const BROADCAST_TONES = ['var(--accent)', 'var(--cool)', 'var(--gold)']

export function broadcastTone(index: number): string {
  return BROADCAST_TONES[index % BROADCAST_TONES.length]
}

export function broadcastMonogram(index: number): string {
  return 'B.' + String(index + 1).padStart(2, '0')
}
