import { format } from 'date-fns'
import { parseDateKey } from '@shared/dates'

export function dayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return 'Today'
  const date = parseDateKey(dateKey)
  const pattern =
    date.getFullYear() === parseDateKey(todayKey).getFullYear() ? 'EEEE, MMMM d' : 'EEEE, MMMM d, yyyy'
  return format(date, pattern)
}
