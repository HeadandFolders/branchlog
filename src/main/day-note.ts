import { DAY_NOTE_MAX_CHARS } from '../shared/day-note.ts'
import type { DayNote } from '../shared/day-note.ts'
import { getDatabase } from './database.ts'

// The note is not a task: no row in tasks, no checkbox, no id, nothing that carries. One row per date,
// and an empty note owns no row at all, so a day nobody annotated reads back as no note.
export function readDayNote(dateKey: string): DayNote | null {
  const row = getDatabase()
    .prepare('SELECT dateKey, text FROM dayNotes WHERE dateKey = ?')
    .get(dateKey) as DayNote | undefined
  if (!row) return null
  return row.text.trim() === '' ? null : row
}

export function readDayNoteText(dateKey: string): string {
  return readDayNote(dateKey)?.text ?? ''
}

export function writeDayNote(dateKey: string, text: string): void {
  const trimmed = text.trim()
  const db = getDatabase()
  if (trimmed === '') {
    db.prepare('DELETE FROM dayNotes WHERE dateKey = ?').run(dateKey)
    return
  }
  if (trimmed.length > DAY_NOTE_MAX_CHARS) throw new Error('Invalid request')
  db.prepare(
    `INSERT INTO dayNotes (dateKey, text, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(dateKey) DO UPDATE SET text = excluded.text, updatedAt = excluded.updatedAt`,
  ).run(dateKey, trimmed, new Date().toISOString())
}
