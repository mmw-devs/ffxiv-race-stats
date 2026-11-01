/** 数字补零到至少两位（1 → "01"，100 → "100"）。 */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Boss 剩余血量 → "42.0%"（保留 1 位小数，与数据契约的小数位一致）。 */
export function formatBossHP(value: number): string {
  return value.toFixed(1) + '%'
}
