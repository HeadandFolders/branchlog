import type { Task } from '@shared/types'
import { relinkAround, restoreCarrySuccessor } from './carry-link'
import { getDatabase } from './database'

export function replaceDay(date: string, tasks: Task[]): void {
  const db = getDatabase()
  const write = db.transaction(() => {
    const existing = db.prepare('SELECT id, carriedFromId FROM tasks WHERE dateCreated = ?').all(date) as {
      id: string
      carriedFromId: string | null
    }[]
    const keep = new Set(tasks.map((task) => task.id))
    const doomed = new Map<string, { carriedFromId: string | null }>()
    for (const row of existing) {
      if (keep.has(row.id)) continue
      doomed.set(row.id, { carriedFromId: row.carriedFromId })
    }
    relinkAround(db, doomed)
    for (const id of doomed.keys()) {
      db.prepare('UPDATE tasks SET parentId = NULL WHERE parentId = ?').run(id)
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    }

    const upsert = db.prepare(
      `INSERT INTO tasks (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
         carriedFromId, chainId, droppedAt, projectId, projectHoldDismissed
       ) VALUES (
         @id, @text, @done, @dateCreated, @dateCompleted, NULL, @x, @y, @width, @height, @side, @orderIndex,
         NULL, @chainId, @droppedAt, (SELECT id FROM aiBriefs WHERE id = @projectId), @dismissed
       )
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         done = excluded.done,
         dateCreated = excluded.dateCreated,
         dateCompleted = excluded.dateCompleted,
         x = excluded.x,
         y = excluded.y,
         width = excluded.width,
         height = excluded.height,
         side = excluded.side,
         orderIndex = excluded.orderIndex,
         chainId = excluded.chainId,
         droppedAt = excluded.droppedAt,
         projectId = excluded.projectId,
         projectHoldDismissed = excluded.projectHoldDismissed`,
    )
    for (const task of tasks) {
      const row = db.prepare('SELECT dateCreated FROM tasks WHERE id = ?').get(task.id) as
        | { dateCreated: string }
        | undefined
      if (row && row.dateCreated !== date) throw new Error('Invalid task')
      upsert.run({
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
    const setCarried = db.prepare('UPDATE tasks SET carriedFromId = ? WHERE id = ?')
    for (const task of tasks) setCarried.run(task.carriedFromId, task.id)
    for (const task of tasks) {
      if (!task.parentId) setParent.run(null, task.id)
    }
    let pending = tasks.filter((task) => task.parentId !== null)
    for (let guard = 0; pending.length > 0 && guard < pending.length + 2; guard += 1) {
      const next: Task[] = []
      for (const task of pending) {
        const parent = db.prepare('SELECT 1 AS ok FROM tasks WHERE id = ?').get(task.parentId) as
          | { ok: number }
          | undefined
        if (parent) setParent.run(task.parentId, task.id)
        else next.push(task)
      }
      if (next.length === pending.length) throw new Error('Invalid task')
      pending = next
    }
    for (const task of tasks) restoreCarrySuccessor(db, task)
  })
  write()
}
