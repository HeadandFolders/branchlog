import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { format } from 'date-fns'
import { parseDateKey } from '@shared/dates'
import { buildCalendarColumns, WEEKDAY_LABELS } from '../lib/calendar-grid'
import { useTodayKey } from '../lib/today'
import { useNotebook } from '../store/notebook'
import { useView } from '../store/view'
import { tempCountRender } from '../temp-first-paint'

interface HoveredCell {
  date: string
  count: number
  x: number
  y: number
}

function tooltipText(dateKey: string, count: number): string {
  const when = format(parseDateKey(dateKey), 'MMM d, yyyy')
  if (count === 0) return `${when} · No tasks completed`
  return `${when} · ${count} ${count === 1 ? 'task' : 'tasks'} completed`
}

export function CalendarView() {
  tempCountRender('CalendarView')
  const todayKey = useTodayKey()
  const goToDate = useNotebook((state) => state.goToDate)
  const showDaily = useView((state) => state.showDaily)
  const columns = useMemo(() => buildCalendarColumns(todayKey), [todayKey])
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<HoveredCell | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    window.branchlog.tasks
      .activityCounts()
      .then((rows) => {
        if (cancelled) return
        const next: Record<string, number> = {}
        for (const row of rows) next[row.date] = row.count
        setCounts(next)
      })
      .catch((cause: unknown) => {
        console.error(cause)
        if (!cancelled) setError('Could not load the calendar.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const openDay = useCallback(
    (date: string) => {
      showDaily()
      void goToDate(date)
    },
    [goToDate, showDaily],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') showDaily()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showDaily])

  const onCellEnter = (event: MouseEvent<HTMLButtonElement>, date: string): void => {
    const grid = gridRef.current
    if (!grid) return
    const cell = event.currentTarget.getBoundingClientRect()
    const box = grid.getBoundingClientRect()
    setHovered({
      date,
      count: counts?.[date] ?? 0,
      x: cell.left - box.left + cell.width / 2,
      y: cell.top - box.top,
    })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="text-[13px] text-[var(--text-muted)] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[var(--text)]"
          onClick={showDaily}
        >
          Back
        </button>
      </div>
      <h1 className="mt-4 text-[32px] font-semibold tracking-[-0.02em] text-[var(--text)]">Activity</h1>
      {error ? (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]" role="status">
          {error}
        </p>
      ) : null}
      <div ref={gridRef} className="relative mt-6 w-fit" data-testid="activity-grid">
        {hovered ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[3px] border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text)]"
            style={{ left: hovered.x, top: hovered.y - 6 }}
            role="status"
          >
            {tooltipText(hovered.date, hovered.count)}
          </div>
        ) : null}
        <div className="flex gap-[3px]">
          <div className="flex w-7 flex-col gap-[3px] pt-[19px]">
            {WEEKDAY_LABELS.map((label, row) => (
              <span key={row} className="flex h-3 items-center text-[11px] leading-none text-[var(--text-muted)]">
                {label}
              </span>
            ))}
          </div>
          {columns.map((column, index) => (
            <div key={index} className="flex flex-col gap-[3px]">
              <span className="h-4 whitespace-nowrap text-[11px] leading-4 text-[var(--text-muted)]">
                {column.monthLabel ?? ''}
              </span>
              {column.days.map((date) => {
                const count = counts?.[date] ?? 0
                return (
                  <button
                    key={date}
                    type="button"
                    data-date={date}
                    data-active={count > 0}
                    aria-label={tooltipText(date, count)}
                    className={`size-3 rounded-[2px] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] ${
                      count > 0 ? 'bg-[var(--active-1)]' : 'bg-[var(--active-0)]'
                    }`}
                    onClick={() => openDay(date)}
                    onMouseEnter={(event) => onCellEnter(event, date)}
                    onMouseLeave={() => setHovered(null)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
