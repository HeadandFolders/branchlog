import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { EarlierTask } from '@shared/types'
import { dayLabel } from '../lib/day-label'
import {
  closeEarlierSearch,
  setEarlierSearchOpen,
  watchEarlierSearch,
} from '../lib/earlier-search'
import { useTodayKey } from '../lib/today'
import { continueOntoToday } from '../store/continuation'

export function EarlierSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<EarlierTask[]>([])
  const [active, setActive] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const todayKey = useTodayKey()

  useEffect(() => {
    return watchEarlierSearch((next) => {
      setOpen(next)
      if (next) {
        setQuery('')
        setActive(0)
        setProblem(null)
      }
    })
  }, [])

  useEffect(() => {
    setEarlierSearchOpen(open)
    return () => setEarlierSearchOpen(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const token = ++request.current
    let stale = false
    void window.branchlog.tasks.searchEarlier(query).then(
      (found) => {
        if (stale || token !== request.current) return
        setRows(found)
        setActive(0)
        setProblem(null)
      },
      (error: unknown) => {
        console.error(error)
        if (stale || token !== request.current) return
        setRows([])
        setProblem('Could not search earlier tasks.')
      },
    )
    return () => {
      stale = true
    }
  }, [open, query])

  useLayoutEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) closeEarlierSearch()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeEarlierSearch()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!open) return null

  const choose = (id: string): void => {
    closeEarlierSearch()
    void continueOntoToday(id)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (rows.length === 0 ? 0 : Math.min(rows.length - 1, index + 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[active]
      if (row) choose(row.id)
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Branch from an earlier task"
      className="absolute inset-x-0 top-10 z-30 bg-[var(--bg)] px-4 pt-3 pb-4"
    >
      <div className="mx-auto w-full max-w-[560px]">
        <input
          ref={inputRef}
          className="w-full border-0 border-b border-[var(--line)] bg-transparent pb-1 text-[16px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--text)]"
          aria-label="Search earlier tasks"
          aria-controls="earlier-task-list"
          aria-activedescendant={rows[active] ? `earlier-task-${rows[active].id}` : undefined}
          placeholder="Search earlier tasks"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {problem ? (
          <p className="mt-3 text-[13px] text-[var(--text-muted)]" role="status">
            {problem}
          </p>
        ) : (
          <ul id="earlier-task-list" role="listbox" aria-label="Earlier tasks" className="mt-2 max-h-80 overflow-y-auto">
            {rows.length === 0 ? (
              <li className="px-2 py-2 text-[13px] text-[var(--text-muted)]">No earlier tasks</li>
            ) : (
              rows.map((row, index) => {
                const text = row.text.trim() === '' ? 'Empty task' : row.text
                return (
                  <li key={row.id}>
                    <button
                      id={`earlier-task-${row.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      className={`flex w-full items-baseline justify-between gap-4 px-2 py-1.5 text-left text-[14px] ${
                        index === active
                          ? 'bg-[var(--bg-subtle)] text-[var(--text)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                      } ${row.done ? 'line-through' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(row.id)}
                    >
                      <span className="min-w-0 truncate">{text}</span>
                      <span className="shrink-0 text-[12px] text-[var(--text-faint)]">
                        {dayLabel(row.dateCreated, todayKey)}
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
