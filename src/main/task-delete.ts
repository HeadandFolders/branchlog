import type Database from 'better-sqlite3'
import type { MapPosition, ParentLink, RemovedTasks, TaskRemoval } from '../shared/types.ts'
import { listCommentsForTasks, restoreCommentsOn } from './ai-store.ts'
import { chainCarriesOn, clearSkipsForRestored, recordSkipsForDeleted } from './carry-skips.ts'
import { relinkAround, type SavedCarryLink } from './carry-link.ts'
import { mapTask, TASK_COLUMNS, type TaskRow } from './task-row.ts'

function isConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  )
}

export function removeTask(db: Database.Database, id: string): TaskRemoval {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('Could not delete that task.')
  }
  const remove = db.transaction((taskId: string): TaskRemoval => {
    const rows = db
      .prepare(
        `WITH RECURSIVE branch(id, dateCreated) AS (
           SELECT id, dateCreated FROM tasks WHERE id = ?
           UNION ALL
           SELECT tasks.id, tasks.dateCreated FROM tasks JOIN branch ON tasks.parentId = branch.id
           WHERE tasks.id = tasks.chainId OR tasks.dateCreated = branch.dateCreated
         )
         SELECT ${TASK_COLUMNS}
         FROM tasks
         WHERE id IN (SELECT id FROM branch)`,
      )
      .all(taskId) as TaskRow[]
    if (rows.length === 0) throw new Error('Invalid task')
    const doomed = new Map(rows.map((row) => [row.id, { carriedFromId: row.carriedFromId }]))
    const carryLinks = relinkAround(db, doomed)
    const ids = rows.map((row) => row.id)
    const marks = ids.map(() => '?').join(', ')
    const parentLinks = db
      .prepare(
        `SELECT id, parentId FROM tasks
         WHERE parentId IN (${marks}) AND id NOT IN (${marks})`,
      )
      .all(...ids, ...ids) as ParentLink[]
    if (parentLinks.length > 0) {
      db.prepare(
        `UPDATE tasks SET parentId = NULL
         WHERE parentId IN (${marks}) AND id NOT IN (${marks})`,
      ).run(...ids, ...ids)
    }
    const mapPositions = db
      .prepare(`SELECT taskId, x, y FROM mapPositions WHERE taskId IN (${marks})`)
      .all(...ids) as MapPosition[]
    const comments = listCommentsForTasks(db, ids)
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    const left = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE id IN (${marks})`).get(...ids) as {
      n: number
    }
    if (left.n !== 0) throw new Error('Could not delete that task.')
    const keys = recordSkipsForDeleted(db, rows)
    const root = rows.find((row) => row.id === taskId)
    const rootKey = root ? keys.get(root.chainId) : null
    const willCarry = Boolean(root?.carriedFromId && rootKey && chainCarriesOn(db, rootKey))
    return {
      removed: { tasks: rows.map(mapTask), mapPositions, carryLinks, parentLinks, comments },
      willCarry,
    }
  })
  return remove(id)
}

export function restoreRemovedOn(db: Database.Database, removed: RemovedTasks): void {
  const write = db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO tasks (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
         carriedFromId, chainId, droppedAt, projectId, projectHoldDismissed
       ) VALUES (
         @id, @text, @done, @dateCreated, @dateCompleted, NULL, @x, @y, @width, @height, @side, @orderIndex,
         NULL, @chainId, @droppedAt, (SELECT id FROM aiBriefs WHERE id = @projectId), @dismissed
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
        chainId: task.chainId,
        droppedAt: task.droppedAt,
        projectId: task.projectId,
        dismissed: task.projectHoldDismissed ? 1 : 0,
      })
    }
    const setParent = db.prepare('UPDATE tasks SET parentId = ? WHERE id = ?')
    for (const task of removed.tasks) {
      if (task.parentId) setParent.run(task.parentId, task.id)
    }
    for (const link of removed.parentLinks) {
      const result = setParent.run(link.parentId, link.id)
      if (result.changes !== 1) throw new Error('Invalid task')
    }
    const setCarried = db.prepare('UPDATE tasks SET carriedFromId = ? WHERE id = ?')
    for (const task of removed.tasks) {
      if (task.carriedFromId) setCarried.run(task.carriedFromId, task.id)
    }
    restoreLinks(removed.carryLinks, setCarried)
    const insertPosition = db.prepare('INSERT INTO mapPositions (taskId, x, y) VALUES (?, ?, ?)')
    for (const position of removed.mapPositions) {
      insertPosition.run(position.taskId, position.x, position.y)
    }
    restoreCommentsOn(db, { comments: removed.comments })
    clearSkipsForRestored(db, removed.tasks)
  })
  try {
    write()
  } catch (error) {
    if (isConstraint(error)) throw new Error('Invalid task')
    throw error
  }
}

function restoreLinks(links: SavedCarryLink[], setCarried: Database.Statement): void {
  for (const link of links) {
    const result = setCarried.run(link.carriedFromId, link.id)
    if (result.changes !== 1) throw new Error('Invalid task')
  }
}
