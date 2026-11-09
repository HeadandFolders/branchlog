import { BRANCH_WIDTH } from '../shared/branch-size.ts'
import { tempMark, tempMs } from '../shared/temp-timing.ts'
import type Database from 'better-sqlite3'

interface ForeignKeyRow {
  from: string
  on_delete: string
}

const TASKS_NEXT = `
CREATE TABLE tasks_next (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  dateCreated TEXT NOT NULL,
  dateCompleted TEXT,
  parentId TEXT REFERENCES tasks_next(id) ON DELETE CASCADE,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT ${BRANCH_WIDTH},
  height REAL NOT NULL DEFAULT 0,
  side TEXT NOT NULL DEFAULT 'main' CHECK (side IN ('main', 'right')),
  orderIndex INTEGER NOT NULL DEFAULT 0,
  carriedFromId TEXT,
  chainId TEXT NOT NULL DEFAULT '',
  droppedAt TEXT
);
`

const TASKS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(dateCreated, side, orderIndex);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parentId);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(dateCompleted);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_chain_date ON tasks(chainId, dateCreated);
CREATE INDEX IF NOT EXISTS idx_tasks_carried_from ON tasks(carriedFromId);
`

const FILL_CHAIN = `
CREATE TRIGGER IF NOT EXISTS tasks_fill_chain
AFTER INSERT ON tasks
WHEN NEW.chainId = ''
BEGIN
  UPDATE tasks SET chainId = NEW.id WHERE id = NEW.id;
END;
`

function parentDeleteAction(db: Database.Database): string | null {
  const keys = db.prepare('PRAGMA foreign_key_list(tasks)').all() as ForeignKeyRow[]
  const parent = keys.find((key) => key.from === 'parentId')
  return parent ? parent.on_delete.toUpperCase() : null
}

function taskColumns(db: Database.Database): Set<string> {
  const rows = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

function ensureTaskSize(db: Database.Database): void {
  const columns = taskColumns(db)
  if (!columns.has('width')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN width REAL NOT NULL DEFAULT ${BRANCH_WIDTH}`)
  }
  if (!columns.has('height')) {
    db.exec('ALTER TABLE tasks ADD COLUMN height REAL NOT NULL DEFAULT 0')
  }
}

function rebuildTasks(db: Database.Database): void {
  const sized = taskColumns(db).has('width') && taskColumns(db).has('height')
  const sizeSql = sized ? 'width, height' : `${BRANCH_WIDTH}, 0`
  db.pragma('foreign_keys = OFF')
  const rebuild = db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS tasks_next')
    db.exec(TASKS_NEXT)
    db.exec(
      `INSERT INTO tasks_next (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
         carriedFromId, chainId, droppedAt
       )
       SELECT id, text, done, dateCreated, dateCompleted, parentId, x, y, ${sizeSql}, side, orderIndex,
         NULL, id, NULL
       FROM tasks`,
    )
    db.exec('DROP TABLE tasks')
    db.exec('ALTER TABLE tasks_next RENAME TO tasks')
    db.exec(TASKS_INDEXES)
  })
  try {
    rebuild()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function ensureCarryColumns(db: Database.Database): void {
  const columns = taskColumns(db)
  if (!columns.has('carriedFromId')) db.exec('ALTER TABLE tasks ADD COLUMN carriedFromId TEXT')
  if (!columns.has('droppedAt')) db.exec('ALTER TABLE tasks ADD COLUMN droppedAt TEXT')
  if (!columns.has('chainId')) db.exec("ALTER TABLE tasks ADD COLUMN chainId TEXT NOT NULL DEFAULT ''")
  const flagged = db.prepare(`SELECT 1 AS ok FROM settings WHERE key = 'carryChainBackfill'`).get()
  if (!flagged) {
    db.exec(`UPDATE tasks SET chainId = id WHERE chainId IS NULL OR chainId = ''`)
    db.prepare(`INSERT INTO settings (key, value) VALUES ('carryChainBackfill', '1')`).run()
  }
  db.exec(TASKS_INDEXES)
  db.exec(FILL_CHAIN)
}

function cleanupOrphans(db: Database.Database): boolean {
  const done = db.prepare(`SELECT value FROM settings WHERE key = 'orphanCleanup'`).get() as
    | { value: string }
    | undefined
  if (done) return true
  const cleanup = db.transaction(() => {
    const orphans = db
      .prepare(
        `SELECT id FROM tasks
         WHERE parentId IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM tasks AS parent WHERE parent.id = tasks.parentId)`,
      )
      .all() as { id: string }[]
    const remove = db.prepare('DELETE FROM tasks WHERE id = ?')
    for (const orphan of orphans) remove.run(orphan.id)
    db.prepare(`DELETE FROM aiComments WHERE taskId NOT IN (SELECT id FROM tasks)`).run()
    db.prepare(`DELETE FROM aiReplies WHERE commentId NOT IN (SELECT id FROM aiComments)`).run()
    db.prepare(`DELETE FROM mapPositions WHERE taskId NOT IN (SELECT id FROM tasks)`).run()
    db.prepare(`INSERT INTO settings (key, value) VALUES ('orphanCleanup', '1')`).run()
  })
  cleanup()
  return false
}

export function migrateTasks(db: Database.Database): void {
  const foreignStart = performance.now()
  const action = parentDeleteAction(db)
  tempMark('migrate-fk', { ms: tempMs(foreignStart), action: action ?? 'none' })
  if (action !== 'CASCADE') {
    const rebuildStart = performance.now()
    rebuildTasks(db)
    tempMark('migrate-rebuild', { ms: tempMs(rebuildStart) })
  } else {
    tempMark('migrate-rebuild-skipped')
  }
  const sizeStart = performance.now()
  ensureTaskSize(db)
  tempMark('migrate-size', { ms: tempMs(sizeStart) })
  const carryStart = performance.now()
  ensureCarryColumns(db)
  tempMark('migrate-carry', { ms: tempMs(carryStart) })
  const orphanStart = performance.now()
  const skipped = cleanupOrphans(db)
  tempMark('migrate-orphan', { ms: tempMs(orphanStart), skipped })
}
