import { format } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { localDateKey, parseDateKey } from '@shared/dates'
import { useNotebook } from '../store/notebook'
import { tempCountRender } from '../temp-first-paint'

function pageTitle(dateKey: string): string {
  const date = parseDateKey(dateKey)
  const pattern = date.getFullYear() === new Date().getFullYear() ? 'EEEE, MMMM d' : 'EEEE, MMMM d, yyyy'
  return format(date, pattern)
}

export function DateHeader() {
  tempCountRender('DateHeader')
  const currentDate = useNotebook((state) => state.currentDate)
  const shiftDate = useNotebook((state) => state.shiftDate)
  const goToDate = useNotebook((state) => state.goToDate)
  const goToToday = useNotebook((state) => state.goToToday)
  const isToday = currentDate === localDateKey()

  return (
    <div>
      <div className="flex items-center gap-3 text-[13px] text-[var(--text-muted)]">
        <button
          type="button"
          className="nopan flex size-6 items-center justify-center transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[var(--text)]"
          aria-label="Previous day"
          title="Previous day"
          onClick={() => void shiftDate(-1)}
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
        <input
          className="date-input nopan"
          type="date"
          aria-label="Choose a date"
          value={currentDate}
          onChange={(event) => {
            if (event.target.value) void goToDate(event.target.value)
          }}
        />
        <button
          type="button"
          className="nopan flex size-6 items-center justify-center transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[var(--text)]"
          aria-label="Next day"
          title="Next day"
          onClick={() => void shiftDate(1)}
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
        {isToday ? null : (
          <button
            type="button"
            className="nopan text-[13px] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[var(--text)]"
            onClick={() => void goToToday()}
          >
            Today
          </button>
        )}
      </div>
      <h1 className="mt-8 text-[32px] font-semibold tracking-[-0.02em] text-[var(--text)]" aria-live="polite">
        {pageTitle(currentDate)}
      </h1>
    </div>
  )
}
