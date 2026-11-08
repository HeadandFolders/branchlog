import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { tempMark, tempMeasuring, tempMs } from '@shared/temp-timing'
import { BRANCH_WIDTH } from '@shared/branch-size'
import { localDateKey } from '@shared/dates'
import type { ActivityCount, CreateBranchInput, CreateTaskInput, Task, UpdateTaskInput } from '@shared/types'
import { migrateTasks } from './migrate'
import { SCHEMA } from './schema'
import { mapTask, TASK_COLUMNS, type TaskRow } from './task-row'

let database: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (database) return database
  const started = performance.now()
  const userData = app.getPath('userData')
  const mkdirStart = performance.now()
  mkdirSync(userData, { recursive: true })
  tempMark('db-mkdir', { ms: tempMs(mkdirStart) })
  const dbPath = path.join(userData, 'branchlog.sqlite')
  const openStart = performance.now()
  const next = new Database(dbPath)
  tempMark('db-open', { ms: tempMs(openStart) })
  const journalStart = performance.now()
  next.pragma('journal_mode = WAL')
  tempMark('db-pragma-journal', { ms: tempMs(journalStart) })
  const foreignStart = performance.now()
  next.pragma('foreign_keys = ON')
  tempMark('db-pragma-foreign-keys', { ms: tempMs(foreignStart) })
  const busyStart = performance.now()
  next.pragma('busy_timeout = 2000')
  tempMark('db-pragma-busy', { ms: tempMs(busyStart) })
  const schemaStart = performance.now()
  next.exec(SCHEMA)
  tempMark('db-schema', { ms: tempMs(schemaStart) })
  const migrateStart = performance.now()
  migrateTasks(next)
  tempMark('db-migrate', { ms: tempMs(migrateStart) })
  if (tempMeasuring()) {
    tempMark('db-pragma-values', {
      journal: String(next.pragma('journal_mode', { simple: true })),
      synchronous: Number(next.pragma('synchronous', { simple: true })),
      foreignKeys: Number(next.pragma('foreign_keys', { simple: true })),
      busyTimeout: Number(next.pragma('busy_timeout', { simple: true })),
    })
  }
  database = next
  tempMark('db-init-total', { ms: tempMs(started) })
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

export function listTasksByDate(dateCreated: string): Task[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${TASK_COLUMNS}
       FROM tasks
       WHERE dateCreated = ?
       ORDER BY CASE side WHEN 'main' THEN 0 ELSE 1 END, orderIndex ASC, rowid ASC`,
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
         id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
         carriedFromId, chainId, droppedAt
       ) VALUES (?, ?, 0, ?, NULL, NULL, 0, 0, ?, 0, 'main', ?, NULL, ?, NULL)`,
    ).run(task.id, task.text, task.dateCreated, BRANCH_WIDTH, orderIndex, task.id)

    return {
      id: task.id,
      text: task.text,
      done: false,
      dateCreated: task.dateCreated,
      dateCompleted: null,
      parentId: null,
      x: 0,
      y: 0,
      width: BRANCH_WIDTH,
      height: 0,
      side: 'main',
      orderIndex,
      carriedFromId: null,
      chainId: task.id,
      droppedAt: null,
    }
  })

  try {
    return insert(input)
  } catch (error) {
    if (isConstraint(error)) throw new Error('Invalid task')
    throw error
  }
}

export function createBranch(input: CreateBranchInput): Task {
  const db = getDatabase()
  const insert = db.transaction((branch: CreateBranchInput): Task => {
    const parent = db
      .prepare(`SELECT id, dateCreated FROM tasks WHERE id = ?`)
      .get(branch.parentId) as { id: string; dateCreated: string } | undefined
    if (!parent || parent.id === branch.id) throw new Error('Invalid task')

    const row = db
      .prepare(
        `SELECT COALESCE(MAX(orderIndex), -1) AS maxIndex
         FROM tasks WHERE dateCreated = ? AND side = 'right'`,
      )
      .get(parent.dateCreated) as { maxIndex: number }
    const orderIndex = row.maxIndex + 1

    db.prepare(
      `INSERT INTO tasks (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
         carriedFromId, chainId, droppedAt
       ) VALUES (?, ?, 0, ?, NULL, ?, ?, ?, ?, 0, 'right', ?, NULL, ?, NULL)`,
    ).run(
      branch.id,
      branch.text,
      parent.dateCreated,
      parent.id,
      branch.x,
      branch.y,
      BRANCH_WIDTH,
      orderIndex,
      branch.id,
    )

    return {
      id: branch.id,
      text: branch.text,
      done: false,
      dateCreated: parent.dateCreated,
      dateCompleted: null,
      parentId: parent.id,
      x: branch.x,
      y: branch.y,
      width: BRANCH_WIDTH,
      height: 0,
      side: 'right',
      orderIndex,
      carriedFromId: null,
      chainId: branch.id,
      droppedAt: null,
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
      `SELECT ${TASK_COLUMNS}
       FROM tasks WHERE id = ?`,
    )
    .get(input.id) as TaskRow | undefined
  if (!existing) throw new Error('Invalid task')

  const hasText = input.text !== undefined
  const hasDone = input.done !== undefined
  const hasX = input.x !== undefined
  const hasY = input.y !== undefined
  const hasWidth = input.width !== undefined
  const hasHeight = input.height !== undefined
  const today = localDateKey()
  const result = db
    .prepare(
      `UPDATE tasks SET
         text = CASE WHEN @hasText = 1 THEN @text ELSE text END,
         done = CASE WHEN @hasDone = 1 THEN @done ELSE done END,
         x = CASE WHEN @hasX = 1 THEN @x ELSE x END,
         y = CASE WHEN @hasY = 1 THEN @y ELSE y END,
         width = CASE WHEN @hasWidth = 1 THEN @width ELSE width END,
         height = CASE WHEN @hasHeight = 1 THEN @height ELSE height END,
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
      hasX: hasX ? 1 : 0,
      x: input.x ?? 0,
      hasY: hasY ? 1 : 0,
      y: input.y ?? 0,
      hasWidth: hasWidth ? 1 : 0,
      width: input.width ?? 0,
      hasHeight: hasHeight ? 1 : 0,
      height: input.height ?? 0,
      today,
    })

  if (result.changes !== 1) throw new Error('Invalid task')

  const updated = db
    .prepare(
      `SELECT ${TASK_COLUMNS}
       FROM tasks WHERE id = ?`,
    )
    .get(input.id) as TaskRow | undefined
  if (!updated) throw new Error('Invalid task')
  return mapTask(updated)
}

export function listActivityCounts(): ActivityCount[] {
  const rows = getDatabase()
    .prepare(
      `SELECT dateCompleted AS date, COUNT(*) AS count
       FROM tasks
       WHERE dateCompleted IS NOT NULL
       GROUP BY dateCompleted`,
    )
    .all() as ActivityCount[]
  return rows
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
