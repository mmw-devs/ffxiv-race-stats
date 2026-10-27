/** 数字补零到至少两位（1 → "01"，100 → "100"）。 */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
