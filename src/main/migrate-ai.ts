import type Database from 'better-sqlite3'

function columns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

const LEFT_ONLY_SIDE = /\bCHECK\s*\(\s*(?:side|"side"|`side`|\[side\])\s*(?:IN\s*\(\s*'left'\s*\)|=\s*'left')\s*\)/i
const COMMENTS_TABLE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:aiComments|"aiComments"|`aiComments`|\[aiComments\])(?=\s*\()/i

function commentsSql(db: Database.Database): string {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'aiComments'`).get() as
    | { sql: string }
    | undefined
  if (!row) throw new Error('Missing AI comments table')
  return row.sql
}

function ensureColumns(db: Database.Database): void {
  const comments = columns(db, 'aiComments')
  if (!comments.has('type')) {
    db.exec(`ALTER TABLE aiComments ADD COLUMN type TEXT NOT NULL DEFAULT 'remark' CHECK (type IN ('question', 'remark', 'correction'))`)
  }
  const replies = columns(db, 'aiReplies')
  if (!replies.has('keptRanges')) {
    db.exec(`ALTER TABLE aiReplies ADD COLUMN keptRanges TEXT NOT NULL DEFAULT '[]'`)
  }
}

function rebuildComments(db: Database.Database): void {
  // Reuse the definition so implicit UNIQUE indexes and any existing columns survive too.
  const original = commentsSql(db)
  if (!COMMENTS_TABLE.test(original)) throw new Error('Cannot migrate AI comments table')
  const next = original
    .replace(COMMENTS_TABLE, 'CREATE TABLE aiComments_next')
    .replace(LEFT_ONLY_SIDE, "CHECK (side IN ('left', 'right'))")
  const objects = db.prepare(
    `SELECT sql FROM sqlite_master WHERE tbl_name = 'aiComments'
     AND type IN ('index', 'trigger') AND sql IS NOT NULL`,
  ).all() as { sql: string }[]
  const names = [...columns(db, 'aiComments')].map((name) => `"${name.replaceAll('"', '""')}"`).join(', ')
  db.exec(next)
  db.exec(`INSERT INTO aiComments_next (rowid, ${names}) SELECT rowid, ${names} FROM aiComments`)
  // Do not rename the old table: aiReplies must keep referencing aiComments.
  db.exec('DROP TABLE aiComments')
  db.exec('ALTER TABLE aiComments_next RENAME TO aiComments')
  for (const object of objects) db.exec(object.sql)
}

export function migrateAi(db: Database.Database): void {
  if (!LEFT_ONLY_SIDE.test(commentsSql(db))) {
    db.transaction(() => ensureColumns(db))()
    return
  }
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      ensureColumns(db)
      rebuildComments(db)
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}