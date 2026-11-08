import type { MapPosition, RemovedTasks, Task, TaskSide } from '@shared/types'
import { getDatabase } from './database'

interface TaskRow {
  id: string
  text: string
  done: number
  dateCreated: string
  dateCompleted: string | null
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
  side: string
  orderIndex: number
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
    width: row.width,
    height: row.height,
    side: asSide(row.side),
    orderIndex: row.orderIndex,
  }
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

export function deleteTask(id: string): RemovedTasks {
  const db = getDatabase()
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('Could not delete that task.')
  }
  const remove = db.transaction((taskId: string): RemovedTasks => {
    const rows = db
      .prepare(
        `WITH RECURSIVE branch(id) AS (
           SELECT id FROM tasks WHERE id = ?
           UNION ALL
           SELECT tasks.id FROM tasks JOIN branch ON tasks.parentId = branch.id
         )
         SELECT id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex
         FROM tasks
         WHERE id IN (SELECT id FROM branch)`,
      )
      .all(taskId) as TaskRow[]
    if (rows.length === 0) throw new Error('Invalid task')
    const ids = rows.map((row) => row.id)
    const marks = ids.map(() => '?').join(', ')
    const mapPositions = db
      .prepare(`SELECT taskId, x, y FROM mapPositions WHERE taskId IN (${marks})`)
      .all(...ids) as MapPosition[]
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    const left = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE id IN (${marks})`).get(...ids) as {
      n: number
    }
    if (left.n !== 0) throw new Error('Could not delete that task.')
    return { tasks: rows.map(mapTask), mapPositions }
  })
  return remove(id)
}

export function restoreRemoved(removed: RemovedTasks): void {
  const db = getDatabase()
  const write = db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO tasks (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex
       ) VALUES (
         @id, @text, @done, @dateCreated, @dateCompleted, NULL, @x, @y, @width, @height, @side, @orderIndex
       )`,
    )
    for (const task of removed.tasks) {
      insert.run({
        id: task.id,
        text: task.text,
        done: task.done ? 1 : 0,
        dateCreated: task.dateCreated,
        dateCompleted: task.dateCompleted,
        x: task.x,
        y: task.y,
        width: task.width,
        height: task.height,
        side: task.side,
        orderIndex: task.orderIndex,
      })
    }
    const setParent = db.prepare('UPDATE tasks SET parentId = ? WHERE id = ?')
    for (const task of removed.tasks) {
      if (task.parentId) setParent.run(task.parentId, task.id)
    }
    const insertPosition = db.prepare('INSERT INTO mapPositions (taskId, x, y) VALUES (?, ?, ?)')
    for (const position of removed.mapPositions) {
      insertPosition.run(position.taskId, position.x, position.y)
    }
  })
  try {
    write()
  } catch (error) {
    if (isConstraint(error)) throw new Error('Invalid task')
    throw error
  }
}
