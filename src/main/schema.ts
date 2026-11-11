import Database from 'better-sqlite3'
import { BRANCH_WIDTH } from '../shared/branch-size.ts'
import { migrateAi } from './migrate-ai.ts'
import { migrateImages } from './migrate-images.ts'
import { migrateTasks } from './migrate.ts'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  dateCreated TEXT NOT NULL,
  dateCompleted TEXT,
  parentId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(dateCreated, side, orderIndex);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parentId);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(dateCompleted);

CREATE TABLE IF NOT EXISTS aiComments (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  side TEXT NOT NULL DEFAULT 'left' CHECK (side IN ('left', 'right')),
  type TEXT NOT NULL DEFAULT 'remark' CHECK (type IN ('question', 'remark', 'correction')),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  keptRanges TEXT NOT NULL DEFAULT '[]',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_comments_task ON aiComments(taskId);

CREATE TABLE IF NOT EXISTS aiReplies (
  id TEXT PRIMARY KEY,
  commentId TEXT NOT NULL REFERENCES aiComments(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'ai')),
  text TEXT NOT NULL,
  keptRanges TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_replies_comment ON aiReplies(commentId);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  dateKey TEXT NOT NULL,
  fileName TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL,
  height REAL NOT NULL,
  cropLeft REAL NOT NULL DEFAULT 0,
  cropTop REAL NOT NULL DEFAULT 0,
  cropRight REAL NOT NULL DEFAULT 0,
  cropBottom REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_images_date ON images(dateKey);

CREATE TABLE IF NOT EXISTS carrySkips (
  chainId TEXT NOT NULL,
  dateKey TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE (chainId, dateKey)
);

CREATE INDEX IF NOT EXISTS idx_carry_skips_chain ON carrySkips(chainId);

CREATE TABLE IF NOT EXISTS mapPositions (
  taskId TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export function applySchema(db: Database.Database, timed?: (step: string, ms: number) => void): void {
  const step = (name: string, run: () => void): void => {
    const started = performance.now()
    run()
    timed?.(name, Math.round((performance.now() - started) * 100) / 100)
  }
  step('schema', () => db.exec(SCHEMA))
  step('migrate', () => migrateTasks(db))
  step('migrate-ai', () => migrateAi(db))
  step('migrate-images', () => migrateImages(db))
}
