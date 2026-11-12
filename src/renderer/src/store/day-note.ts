import { create } from 'zustand'

const WRITE_DELAY_MS = 400

interface DayNoteState {
  date: string
  text: string
  saved: string
  editing: boolean
  error: string | null
  open: (date: string) => Promise<void>
  start: () => void
  stop: () => void
  change: (text: string) => void
  flush: () => void
}

let timer: number | null = null
let pendingDate: string | null = null
let pendingText = ''

// One write at a time, and always for the date the text belongs to — leaving the day flushes the note
// that was being typed rather than dropping it.
function writeNow(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (pendingDate === null) return
  const date = pendingDate
  const text = pendingText
  pendingDate = null
  try {
    const result = window.branchlog.dayNote.setSync(date, text)
    if (result.ok) {
      useDayNote.setState((state) => (state.date === date ? { saved: text, error: null } : {}))
      return
    }
    useDayNote.setState({ error: 'Could not save the day note.' })
  } catch (error) {
    console.error(error)
    useDayNote.setState({ error: 'Could not save the day note.' })
  }
}

export const useDayNote = create<DayNoteState>((set, get) => ({
  date: '',
  text: '',
  saved: '',
  editing: false,
  error: null,

  open: async (date) => {
    if (get().date !== date) writeNow()
    set({ date, text: '', saved: '', editing: false, error: null })
    try {
      const note = await window.branchlog.dayNote.get(date)
      if (get().date !== date) return
      const text = note?.text ?? ''
      set({ text, saved: text })
    } catch (error) {
      console.error(error)
      if (get().date === date) set({ error: 'The day note could not be read.' })
    }
  },

  start: () => set({ editing: true }),

  stop: () => {
    set({ editing: false })
    writeNow()
  },

  change: (text) => {
    set({ text })
    pendingDate = get().date
    pendingText = text
    if (timer !== null) clearTimeout(timer)
    timer = window.setTimeout(writeNow, WRITE_DELAY_MS)
  },

  flush: () => writeNow(),
}))

export function flushDayNote(): void {
  useDayNote.getState().flush()
}
