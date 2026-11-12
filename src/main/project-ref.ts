import type Database from 'better-sqlite3'

// A binding only counts while the brief is still linked, so an id whose row is gone binds nothing.
// The bulk writes (day replace, restore, carry) do this inside their own SQL; the single-row creates
// ask here, because they also have to hand the row back with the value the database kept.
export function resolveProject(db: Database.Database, id: string | null | undefined): string | null {
  if (id === null || id === undefined) return null
  const row = db.prepare('SELECT id FROM aiBriefs WHERE id = ?').get(id) as { id: string } | undefined
  return row?.id ?? null
}
