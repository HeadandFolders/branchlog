import { getDatabase } from './database'

const SWIPE_TO_PAN = 'swipeToPan'

export function readSwipeToPan(): boolean {
  const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(SWIPE_TO_PAN) as
    | { value: string }
    | undefined
  if (!row) return true
  return row.value !== '0'
}

export function writeSwipeToPan(on: boolean): void {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(SWIPE_TO_PAN, on ? '1' : '0')
}
