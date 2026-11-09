import type Database from 'better-sqlite3'

function columns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

export function migrateAi(db: Database.Database): void {
  const comments = columns(db, 'aiComments')
  if (!comments.has('type')) {
    db.exec(`ALTER TABLE aiComments ADD COLUMN type TEXT NOT NULL DEFAULT 'remark' CHECK (type IN ('question', 'remark', 'correction'))`)
  }
  const replies = columns(db, 'aiReplies')
  if (!replies.has('keptRanges')) {
    db.exec(`ALTER TABLE aiReplies ADD COLUMN keptRanges TEXT NOT NULL DEFAULT '[]'`)
  }
}