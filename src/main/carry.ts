import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { addDays, localDateKey } from '../shared/dates.ts'
import { taskLife, type TaskLife } from '../shared/task-life.ts'
import type { Task } from '../shared/types.ts'
import { mapTask, TASK_COLUMNS, type TaskRow } from './task-row.ts'

export const DEFAULT_CARRY_WINDOW_DAYS = 14
export const CARRY_PAINT_BUDGET_MS = 20

const AUTO_CARRY = 'autoCarry'
const CARRY_WINDOW = 'carryWindowDays'

interface CarrySource extends TaskRow {
  rowid: number
}

export interface CarryResult {
  date: string
  tasks: Task[]
  ms: number
}

const CANDIDATE_SQL = `
WITH latest AS (
  SELECT chainId, MAX(dateCreated) AS dateCreated
  FROM tasks
  GROUP BY chainId
)
SELECT t.rowid AS rowid, ${TASK_COLUMNS.split(', ').map((column) => `t.${column}`).join(', ')}
FROM tasks AS t
JOIN latest AS l ON l.chainId = t.chainId AND l.dateCreated = t.dateCreated
WHERE t.dateCreated < @today
  AND t.dateCreated >= @start
  AND t.dateCompleted IS NULL
  AND t.droppedAt IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM tasks AS taken
    WHERE taken.chainId = t.chainId AND taken.dateCreated = @today
  )
`

export function carryCandidateSql(): string {
  return CANDIDATE_SQL
}

function setting(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function readAutoCarry(db: Database.Database): boolean {
  return setting(db, AUTO_CARRY) !== '0'
}

export function writeAutoCarry(db: Database.Database, on: boolean): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(AUTO_CARRY, on ? '1' : '0')
}

export function readCarryWindowDays(db: Database.Database): number {
  const raw = setting(db, CARRY_WINDOW)
  if (raw === undefined) return DEFAULT_CARRY_WINDOW_DAYS
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 3660) return DEFAULT_CARRY_WINDOW_DAYS
  return value
}

export function countCarryInput(db: Database.Database): number {
  if (!readAutoCarry(db)) return 0
  const today = localDateKey()
  const start = addDays(today, -readCarryWindowDays(db))
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks
       WHERE dateCreated < ? AND dateCreated >= ?
         AND dateCompleted IS NULL AND droppedAt IS NULL`,
    )
    .get(today, start) as { n: number }
  return row.n
}

function isChainUnique(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  )
}

export function carryForward(db: Database.Database): CarryResult {
  const started = performance.now()
  const today = localDateKey()
  const copy = db.transaction((): Task[] => copyUnfinished(db, today))
  let tasks: Task[] = []
  try {
    tasks = copy.immediate()
  } catch (error) {
    if (!isChainUnique(error)) throw error
    console.error(error)
    tasks = []
  }
  return { date: today, tasks, ms: performance.now() - started }
}

function copyUnfinished(db: Database.Database, today: string): Task[] {
  if (!readAutoCarry(db)) return []
  const start = addDays(today, -readCarryWindowDays(db))
  const rows = db.prepare(CANDIDATE_SQL).all({ today, start }) as CarrySource[]
  if (rows.length === 0) return []

  const byId = new Map(rows.map((row) => [row.id, row]))
  const rides = (row: CarrySource): boolean =>
    row.side === 'right' && row.parentId !== null && byId.has(row.parentId)
  const roots = rows.filter((row) => !rides(row)).sort(compareRoot)
  const riders = riderOrder(rows.filter(rides), byId)

  const mainMax = db
    .prepare(
      `SELECT COALESCE(MAX(orderIndex), -1) AS n FROM tasks WHERE dateCreated = ? AND side = 'main'`,
    )
    .get(today) as { n: number }
  const rightMax = db
    .prepare(
      `SELECT COALESCE(MAX(orderIndex), -1) AS n FROM tasks WHERE dateCreated = ? AND side = 'right'`,
    )
    .get(today) as { n: number }

  const ids = new Map<string, string>()
  for (const row of rows) ids.set(row.id, randomUUID())

  const insert = db.prepare(
    `INSERT INTO tasks (
       id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
       carriedFromId, chainId, droppedAt
     ) VALUES (
       @id, @text, 0, @dateCreated, NULL, @parentId, @x, @y, @width, @height, @side, @orderIndex,
       @carriedFromId, @chainId, NULL
     )`,
  )

  const created: Task[] = []
  let mainOrder = mainMax.n
  for (const row of roots) {
    mainOrder += 1
    const id = ids.get(row.id)
    if (!id) throw new Error('Invalid task')
    const task = carriedTask(row, id, today, 'main', row.parentId, mainOrder)
    insert.run(taskRow(task))
    created.push(task)
  }

  let rightOrder = rightMax.n
  for (const row of riders) {
    rightOrder += 1
    const id = ids.get(row.id)
    const parentId = row.parentId ? ids.get(row.parentId) : undefined
    if (!id || !parentId) throw new Error('Invalid task')
    const task = carriedTask(row, id, today, 'right', parentId, rightOrder)
    insert.run(taskRow(task))
    created.push(task)
  }
  return created
}

function carriedTask(
  row: CarrySource,
  id: string,
  today: string,
  side: 'main' | 'right',
  parentId: string | null,
  orderIndex: number,
): Task {
  return {
    id,
    text: row.text,
    done: false,
    dateCreated: today,
    dateCompleted: null,
    parentId,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    side,
    orderIndex,
    carriedFromId: row.id,
    chainId: row.chainId,
    droppedAt: null,
  }
}

function taskRow(task: Task): Record<string, string | number | null> {
  return {
    id: task.id,
    text: task.text,
    dateCreated: task.dateCreated,
    parentId: task.parentId,
    x: task.x,
    y: task.y,
    width: task.width,
    height: task.height,
    side: task.side,
    orderIndex: task.orderIndex,
    carriedFromId: task.carriedFromId,
    chainId: task.chainId,
  }
}

function compareRoot(a: CarrySource, b: CarrySource): number {
  if (a.dateCreated !== b.dateCreated) return a.dateCreated < b.dateCreated ? -1 : 1
  if (a.side !== b.side) return a.side === 'main' ? -1 : 1
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex
  return a.rowid - b.rowid
}

function riderOrder(riders: CarrySource[], byId: Map<string, CarrySource>): CarrySource[] {
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const parent = byId.get(id)?.parentId
    const value = parent && byId.has(parent) ? depthOf(parent) + 1 : 0
    visiting.delete(id)
    depth.set(id, value)
    return value
  }
  return [...riders].sort(
    (a, b) => depthOf(a.id) - depthOf(b.id) || a.orderIndex - b.orderIndex || a.rowid - b.rowid,
  )
}

export function dropTask(db: Database.Database, id: string): void {
  const row = db.prepare('SELECT droppedAt FROM tasks WHERE id = ?').get(id) as
    | { droppedAt: string | null }
    | undefined
  if (!row) throw new Error('Invalid task')
  if (row.droppedAt) return
  db.prepare('UPDATE tasks SET droppedAt = ? WHERE id = ?').run(localDateKey(), id)
}

export function undropTask(db: Database.Database, id: string): void {
  const result = db.prepare('UPDATE tasks SET droppedAt = NULL WHERE id = ?').run(id)
  if (result.changes !== 1) throw new Error('Invalid task')
}

export function readTaskLife(db: Database.Database, id: string): TaskLife {
  const row = db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined
  if (!row) throw new Error('Invalid task')
  const later = db
    .prepare('SELECT 1 AS ok FROM tasks WHERE chainId = ? AND dateCreated > ? LIMIT 1')
    .get(row.chainId, row.dateCreated) as { ok: number } | undefined
  return taskLife(mapTask(row), later !== undefined)
}
