import { getDatabase } from './database'

const AUTO_SEPARATE = 'autoSeparate'
const SWIPE_TO_PAN = 'swipeToPan'
const HIGHLIGHT_CARRIED = 'highlightCarried'

function readFlag(key: string): boolean {
  const row = getDatabase().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  if (!row) return true
  return row.value !== '0'
}

function writeFlag(key: string, on: boolean): void {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, on ? '1' : '0')
}

export function readAutoSeparate(): boolean {
  return readFlag(AUTO_SEPARATE)
}

export function writeAutoSeparate(on: boolean): void {
  writeFlag(AUTO_SEPARATE, on)
}

export function readSwipeToPan(): boolean {
  return readFlag(SWIPE_TO_PAN)
}

export function writeSwipeToPan(on: boolean): void {
  writeFlag(SWIPE_TO_PAN, on)
}

export function readHighlightCarried(): boolean {
  return readFlag(HIGHLIGHT_CARRIED)
}

export function writeHighlightCarried(on: boolean): void {
  writeFlag(HIGHLIGHT_CARRIED, on)
}
