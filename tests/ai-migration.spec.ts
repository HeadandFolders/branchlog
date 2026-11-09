import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { applySchema } from '../src/main/schema'
import { migrateAi } from '../src/main/migrate-ai'

function oldDatabase(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY);
    CREATE TABLE aiComments (
      id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      side TEXT NOT NULL DEFAULT 'left' CHECK (side IN ('left')),
      text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      keptRanges TEXT NOT NULL DEFAULT '[]', x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX idx_ai_task ON aiComments(taskId);
    CREATE TABLE aiReplies (
      id TEXT PRIMARY KEY, commentId TEXT NOT NULL REFERENCES aiComments(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'ai')), text TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    INSERT INTO tasks VALUES ('task');
    INSERT INTO aiComments VALUES ('comment', 'task', 'left', 'Original text', 'resolved', '[[0,8]]', -272, 42, '2026-11-09T10:00:00.000Z');
    INSERT INTO aiReplies VALUES ('reply', 'comment', 'ai', 'Original reply', '2026-11-09T10:01:00.000Z');
  `)
  return db
}

test('side migration preserves old comments, reply rows, offsets, positions and indexes', () => {
  const db = oldDatabase()
  try {
    const before = db.prepare('SELECT * FROM aiComments').get() as Record<string, unknown>
    const reply = db.prepare('SELECT * FROM aiReplies').get() as Record<string, unknown>
    migrateAi(db)
    expect(db.prepare('SELECT * FROM aiComments').get()).toEqual({ ...before, type: 'remark' })
    expect(db.prepare('SELECT * FROM aiReplies').get()).toEqual({ ...reply, keptRanges: '[]' })
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_ai_task'").get()).toBeTruthy()
    db.prepare("INSERT INTO aiComments (id, taskId, side, text, createdAt) VALUES ('answer', 'task', 'right', 'Helpful answer', '2026-11-09T10:02:00.000Z')").run()
    expect(db.prepare("SELECT side FROM aiComments WHERE id = 'answer'").get()).toEqual({ side: 'right' })
    const rows = db.prepare('SELECT * FROM aiComments ORDER BY rowid').all()
    migrateAi(db)
    expect(db.prepare('SELECT * FROM aiComments ORDER BY rowid').all()).toEqual(rows)
    db.prepare("DELETE FROM tasks WHERE id = 'task'").run()
    expect(db.prepare('SELECT * FROM aiComments').all()).toEqual([])
    expect(db.prepare('SELECT * FROM aiReplies').all()).toEqual([])
  } finally {
    db.close()
  }
})

test('a failed migration rolls back rows and schema and restores foreign key enforcement', () => {
  const db = oldDatabase()
  try {
    db.exec('CREATE TABLE aiComments_next (id TEXT)')
    const before = db.prepare('SELECT * FROM aiComments').all()
    const replies = db.prepare('SELECT * FROM aiReplies').all()
    expect(() => migrateAi(db)).toThrow()
    expect(db.prepare('SELECT * FROM aiComments').all()).toEqual(before)
    expect(db.prepare('SELECT * FROM aiReplies').all()).toEqual(replies)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'aiComments'").get()).toMatchObject({ sql: expect.stringContaining("side IN ('left')") })
  } finally {
    db.close()
  }
})

test('one boot order creates the AI tables and reports every step for timing', () => {
  const db = new Database(':memory:')
  try {
    const steps: [string, number][] = []
    applySchema(db, (step, ms) => steps.push([step, ms]))
    expect(steps.map(([step]) => step)).toEqual(['schema', 'migrate', 'migrate-ai', 'migrate-images'])
    for (const [, ms] of steps) expect(Number.isFinite(ms) && ms >= 0).toBe(true)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
    for (const table of ['aiComments', 'aiReplies']) expect(tables).toContain(table)
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'aiComments'").get()).toMatchObject({
      sql: expect.stringContaining("side IN ('left', 'right')"),
    })
  } finally {
    db.close()
  }
})
