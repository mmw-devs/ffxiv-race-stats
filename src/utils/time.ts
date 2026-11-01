/**
 * 时间展示纯函数。
 *
 * data.json 里的时间统一是含时区的 ISO 8601 瞬时；展示层只做两件事：
 * - 相对时间（速报 24h 内）
 * - 访客本地绝对时间（避免直接截 ISO 字符串导致时区错位）
 */

import { pad2 } from './format'

/** 按访客本地时区格式化为 YYYY-MM-DD。 */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 按访客本地时区格式化为 YYYY-MM-DD HH:MM。 */
export function formatLocalDateTime(date: Date): string {
  return `${formatLocalDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * 解析 ISO 瞬时。
 * schema 允许 meta.startTime 用 "-" 表示「时间未知」，这里与非法值一并返回 null。
 */
export function parseInstant(value: string): Date | null {
  if (!value || value === '-') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms)
}

/** 已开赛时长 → "+HH:MM:SS"；负数按 0 处理。 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return '+' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
}

/**
 * 速报时间：24h 内用相对时间，超过则用访客本地绝对时间；无法解析时原样返回。
 * now 由调用方传入，便于测试并复用一个全局时钟。
 */
export function formatNewsTime(iso: string, now: number): string {
  const date = parseInstant(iso)
  if (!date) return iso
  const diff = now - date.getTime()
  if (diff >= 0) {
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  }
  return formatLocalDateTime(date)
}

/** 开赛日期标签："YYYY-MM-DD 起"；占位符 / 非法 / 空值返回空串。 */
export function formatStartLabel(startTime: string): string {
  const date = parseInstant(startTime)
  return date ? `${formatLocalDate(date)} 起` : ''
}

/** 访客本地时钟 HH:MM:SS（用于「已同步 / 最近检查」）。 */
export function formatLocalTime(ms: number): string {
  const date = new Date(ms)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export type StartTimeState =
  | { kind: 'unknown' }
  | { kind: 'future'; start: Date; msUntil: number }
  | { kind: 'passed'; start: Date; msSince: number }

/**
 * 开赛时间相对当前时刻的状态。
 * "-"、空值、非法值统一视为未知，由调用方决定展示文案。
 */
export function resolveStartTime(startTime: string | undefined, now: number): StartTimeState {
  const start = parseInstant(startTime ?? '')
  if (!start) return { kind: 'unknown' }

  const msUntil = start.getTime() - now
  return msUntil > 0
    ? { kind: 'future', start, msUntil }
    : { kind: 'passed', start, msSince: -msUntil }
}

/** 倒计时格式化 HH:MM:SS；小时不进位到天，是否显示日期由调用方决定。 */
export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}
