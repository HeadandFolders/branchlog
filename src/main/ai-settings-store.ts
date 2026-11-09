import { defaultAiSettings, parseAiSettings, type AiSettings } from '@shared/ai-settings'
import { getDatabase } from './database'

const KEY = 'ai'

export function readAiSettings(): AiSettings {
  const row = getDatabase().prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as
    | { value: string }
    | undefined
  if (!row) return defaultAiSettings()
  try {
    return parseAiSettings(JSON.parse(row.value) as unknown)
  } catch (error) {
    console.error(error)
    return defaultAiSettings()
  }
}

export function writeAiSettings(settings: AiSettings): void {
  const clean = parseAiSettings(settings)
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(KEY, JSON.stringify(clean))
}