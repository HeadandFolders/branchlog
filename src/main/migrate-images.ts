import type Database from 'better-sqlite3'

function columns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

export function migrateImages(db: Database.Database): void {
  const images = columns(db, 'images')
  if (!images.has('cropLeft')) db.exec('ALTER TABLE images ADD COLUMN cropLeft REAL NOT NULL DEFAULT 0')
  if (!images.has('cropTop')) db.exec('ALTER TABLE images ADD COLUMN cropTop REAL NOT NULL DEFAULT 0')
  if (!images.has('cropRight')) db.exec('ALTER TABLE images ADD COLUMN cropRight REAL NOT NULL DEFAULT 0')
  if (!images.has('cropBottom')) db.exec('ALTER TABLE images ADD COLUMN cropBottom REAL NOT NULL DEFAULT 0')
}
