import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { localDateKey } from '@shared/dates'
import type { CreateTaskInput, Task, TaskSide, UpdateTaskInput } from '@shared/types'

interface TaskRow {
  id: string
  text: string
  done: number
  dateCreated: string
  dateCompleted: string | null
  parentId: string | null
  x: number
  y: number
  side: string
  orderIndex: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  dateCreated TEXT NOT NULL,
  dateCompleted TEXT,
  parentId TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  side TEXT NOT NULL DEFAULT 'main' CHECK (side IN ('main', 'right')),
  orderIndex INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(dateCreated, side, orderIndex);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parentId);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(dateCompleted);

CREATE TABLE IF NOT EXISTS aiComments (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  side TEXT NOT NULL DEFAULT 'left' CHECK (side IN ('left')),
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
  height REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_date ON images(dateKey);

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

let database: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (database) return database
  const userData = app.getPath('userData')
  mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, 'branchlog.sqlite')
  const next = new Database(dbPath)
  next.pragma('journal_mode = WAL')
  next.pragma('foreign_keys = ON')
  next.pragma('busy_timeout = 2000')
  next.exec(SCHEMA)
  database = next
  console.log(`Branchlog database: ${dbPath}`)
  return next
}

export function getDatabase(): Database.Database {
  if (!database) throw new Error('Database is not ready')
  return database
}

export function closeDatabase(): void {
  if (!database) return
  database.close()
  database = null
}

function asSide(value: string): TaskSide {
  if (value === 'main' || value === 'right') return value
  throw new Error('Invalid task')
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    text: row.text,
    done: row.done === 1,
    dateCreated: row.dateCreated,
    dateCompleted: row.dateCompleted,
    parentId: row.parentId,
    x: row.x,
    y: row.y,
    side: asSide(row.side),
    orderIndex: row.orderIndex,
  }
}

export function listTasksByDate(dateCreated: string): Task[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, text, done, dateCreated, dateCompleted, parentId, x, y, side, orderIndex
       FROM tasks
       WHERE dateCreated = ? AND side = 'main'
       ORDER BY orderIndex ASC, rowid ASC`,
    )
    .all(dateCreated) as TaskRow[]
  return rows.map(mapTask)
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDatabase()
  const insert = db.transaction((task: CreateTaskInput): Task => {
    let orderIndex = 0
    if (task.afterId) {
      const after = db
        .prepare(
          `SELECT orderIndex FROM tasks
           WHERE id = ? AND dateCreated = ? AND side = 'main'`,
        )
        .get(task.afterId, task.dateCreated) as { orderIndex: number } | undefined
      if (!after) throw new Error('Invalid task')
      orderIndex = after.orderIndex + 1
      db.prepare(
        `UPDATE tasks SET orderIndex = orderIndex + 1
         WHERE dateCreated = ? AND side = 'main' AND orderIndex >= ?`,
      ).run(task.dateCreated, orderIndex)
    } else {
      const row = db
        .prepare(
          `SELECT COALESCE(MAX(orderIndex), -1) AS maxIndex
           FROM tasks WHERE dateCreated = ? AND side = 'main'`,
        )
        .get(task.dateCreated) as { maxIndex: number }
      orderIndex = row.maxIndex + 1
    }

    db.prepare(
      `INSERT INTO tasks (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, side, orderIndex
       ) VALUES (?, ?, 0, ?, NULL, NULL, 0, 0, 'main', ?)`,
    ).run(task.id, task.text, task.dateCreated, orderIndex)

    return {
      id: task.id,
      text: task.text,
      done: false,
      dateCreated: task.dateCreated,
      dateCompleted: null,
      parentId: null,
      x: 0,
      y: 0,
      side: 'main',
      orderIndex,
    }
  })

  try {
    return insert(input)
  } catch (error) {
    if (isConstraint(error)) throw new Error('Invalid task')
    throw error
  }
}

export function updateTask(input: UpdateTaskInput): Task {
  const db = getDatabase()
  const existing = db
    .prepare(
      `SELECT id, text, done, dateCreated, dateCompleted, parentId, x, y, side, orderIndex
       FROM tasks WHERE id = ?`,
    )
    .get(input.id) as TaskRow | undefined
  if (!existing) throw new Error('Invalid task')

  const hasText = input.text !== undefined
  const hasDone = input.done !== undefined
  const today = localDateKey()
  const result = db
    .prepare(
      `UPDATE tasks SET
         text = CASE WHEN @hasText = 1 THEN @text ELSE text END,
         done = CASE WHEN @hasDone = 1 THEN @done ELSE done END,
         dateCompleted = CASE
           WHEN @hasDone = 0 THEN dateCompleted
           WHEN @done = 1 THEN @today
           ELSE NULL
         END
       WHERE id = @id`,
    )
    .run({
      id: input.id,
      hasText: hasText ? 1 : 0,
      text: input.text ?? '',
      hasDone: hasDone ? 1 : 0,
      done: input.done ? 1 : 0,
      today,
    })

  if (result.changes !== 1) throw new Error('Invalid task')

  const updated = db
    .prepare(
      `SELECT id, text, done, dateCreated, dateCompleted, parentId, x, y, side, orderIndex
       FROM tasks WHERE id = ?`,
    )
    .get(input.id) as TaskRow | undefined
  if (!updated) throw new Error('Invalid task')
  return mapTask(updated)
}

export function deleteTask(id: string): void {
  getDatabase().prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

function isConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  )
}
