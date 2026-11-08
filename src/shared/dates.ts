import { now, testNowSetting } from './clock.ts'

export { now, testNowSetting }

export function localDateKey(date = now()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(dateKey: string): Date {
  const year = Number(dateKey.slice(0, 4))
  const month = Number(dateKey.slice(5, 7))
  const day = Number(dateKey.slice(8, 10))
  return new Date(year, month - 1, day)
}

export function addDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

export function msUntilNextLocalMidnight(from = now()): number {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 0)
  const delay = next.getTime() - from.getTime()
  return delay > 0 ? delay : 1
}
