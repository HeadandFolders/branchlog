import { format } from 'date-fns'
import { localDateKey, parseDateKey } from '@shared/dates'

export interface CalendarColumn {
  days: string[]
  monthLabel: string | null
}

export const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

export function buildCalendarColumns(todayKey: string): CalendarColumn[] {
  const start = parseDateKey(todayKey)
  start.setDate(start.getDate() - start.getDay() - 52 * 7)
  const columns: CalendarColumn[] = []
  let labeledMonth: number | null = null
  for (let week = 0; week < 53; week += 1) {
    const days: string[] = []
    let label: string | null = null
    for (let day = 0; day < 7; day += 1) {
      days.push(localDateKey(start))
      const month = start.getMonth()
      if (label === null && (labeledMonth === null || month !== labeledMonth)) {
        label = format(start, 'MMM')
        labeledMonth = month
      }
      start.setDate(start.getDate() + 1)
    }
    columns.push({ days, monthLabel: label })
  }
  return columns
}
