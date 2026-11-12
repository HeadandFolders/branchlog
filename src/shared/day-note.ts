export const DAY_NOTE_MAX_CHARS = 2_000

export interface DayNote {
  dateKey: string
  text: string
}

export function isDayNote(value: unknown): value is DayNote {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return typeof input.dateKey === 'string' && typeof input.text === 'string'
}

export function isDayNoteResult(value: unknown): value is DayNote {
  return value === null || isDayNote(value)
}
