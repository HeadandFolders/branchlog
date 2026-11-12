import { useEffect, useLayoutEffect, useRef } from 'react'
import { DAY_NOTE_MAX_CHARS } from '@shared/day-note'
import { useDayNote } from '../store/day-note'
import { useNotebook } from '../store/notebook'
import '../styles/day-note.css'

// The note is not a task: no checkbox, no row in tasks, nothing that carries. It only ever says
// something about the day, and the AI reads it as the day's own note.
export function DayNote() {
  const currentDate = useNotebook((state) => state.currentDate)
  const text = useDayNote((state) => state.text)
  const editing = useDayNote((state) => state.editing)
  const error = useDayNote((state) => state.error)
  const start = useDayNote((state) => state.start)
  const stop = useDayNote((state) => state.stop)
  const change = useDayNote((state) => state.change)
  const field = useRef<HTMLTextAreaElement>(null)
  const opening = useRef(false)

  useEffect(() => {
    void useDayNote.getState().open(currentDate)
  }, [currentDate])

  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
    if (!opening.current) return
    opening.current = false
    element.focus({ preventScroll: true })
  }, [editing, text])

  if (!editing && text === '') {
    return (
      <button
        type="button"
        className="day-note-empty nopan"
        data-day-note-empty="true"
        onClick={() => {
          opening.current = true
          start()
        }}
      >
        Add a note about this day
      </button>
    )
  }

  return (
    <div className="day-note-wrap nopan">
      <textarea
        ref={field}
        className="day-note"
        data-day-note-text="true"
        aria-label="Day note"
        rows={1}
        maxLength={DAY_NOTE_MAX_CHARS}
        value={text}
        placeholder="A note about this day"
        onChange={(event) => change(event.target.value)}
        onBlur={stop}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.currentTarget.blur()
        }}
      />
      {error ? (
        <p className="day-note-error" role="alert" data-day-note-error="true">
          {error}
        </p>
      ) : null}
    </div>
  )
}
