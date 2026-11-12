import { BRIEFS_MAX_CHARS_RANGE, DEFAULT_BRIEFS_MAX_CHARS } from '@shared/ai-briefs'
import { getDatabase } from './database'

const AUTO_SEPARATE = 'autoSeparate'
const SWIPE_TO_PAN = 'swipeToPan'
const HIGHLIGHT_CARRIED = 'highlightCarried'
const MAP_EXPAND_CHAINS = 'mapExpandChains'
const BRIEFS_MAX_CHARS = 'briefsMaxChars'

function readFlag(key: string, whenMissing = true): boolean {
  const row = getDatabase().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  if (!row) return whenMissing
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

export function readMapExpandChains(): boolean {
  return readFlag(MAP_EXPAND_CHAINS, false)
}

export function writeMapExpandChains(on: boolean): void {
  writeFlag(MAP_EXPAND_CHAINS, on)
}

export function readBriefsMaxChars(): number {
  const row = getDatabase().prepare(`SELECT value FROM settings WHERE key = ?`).get(BRIEFS_MAX_CHARS) as
    | { value: string }
    | undefined
  if (!row) return DEFAULT_BRIEFS_MAX_CHARS
  const value = Number.parseInt(row.value, 10)
  if (!Number.isInteger(value) || value < BRIEFS_MAX_CHARS_RANGE.min || value > BRIEFS_MAX_CHARS_RANGE.max) {
    return DEFAULT_BRIEFS_MAX_CHARS
  }
  return value
}

export function writeBriefsMaxChars(value: number): void {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(BRIEFS_MAX_CHARS, String(value))
}
