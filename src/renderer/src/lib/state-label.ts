import { format } from 'date-fns'
import { localDateKey, parseDateKey } from '@shared/dates'

export function shortDate(dateKey: string): string {
  const date = parseDateKey(dateKey)
  const pattern = date.getFullYear() === parseDateKey(localDateKey()).getFullYear() ? 'MMM d' : 'MMM d, yyyy'
  return format(date, pattern)
}

export function carriedLabel(fromDay: string, days: number): string {
  return `Carried from ${shortDate(fromDay)} · day ${days}`
}

export function finishedLaterLabel(day: string): string {
  return `Finished ${shortDate(day)}`
}

export function droppedLabel(day: string): string {
  return `Let go on ${shortDate(day)}`
}
