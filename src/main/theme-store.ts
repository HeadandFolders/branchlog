import { defaultTheme, parseThemeDocument, type ThemeDocument } from '@shared/theme'
import { getDatabase } from './database'

const KEY = 'theme'

export function readTheme(): ThemeDocument {
  const row = getDatabase().prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as
    | { value: string }
    | undefined
  if (!row) return defaultTheme()
  try {
    return parseThemeDocument(JSON.parse(row.value) as unknown)
  } catch (error) {
    console.error(error)
    return defaultTheme()
  }
}

export function writeTheme(theme: ThemeDocument): void {
  const clean = parseThemeDocument(theme)
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(KEY, JSON.stringify(clean))
}
