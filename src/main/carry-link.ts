import type Database from 'better-sqlite3'
import type { Task } from '../shared/types.ts'

export interface SavedCarryLink {
  id: string
  carriedFromId: string | null
}

interface DoomedCarry {
  carriedFromId: string | null
}

export function relinkAround(
  db: Database.Database,
  doomed: ReadonlyMap<string, DoomedCarry>,
): SavedCarryLink[] {
  if (doomed.size === 0) return []
  const ids = [...doomed.keys()]
  const marks = ids.map(() => '?').join(', ')
  const survivors = db
    .prepare(
      `SELECT id, carriedFromId FROM tasks
       WHERE carriedFromId IN (${marks}) AND id NOT IN (${marks})`,
    )
    .all(...ids, ...ids) as { id: string; carriedFromId: string | null }[]
  const update = db.prepare('UPDATE tasks SET carriedFromId = ? WHERE id = ?')
  const saved: SavedCarryLink[] = []
  for (const survivor of survivors) {
    let next = survivor.carriedFromId
    const seen = new Set<string>()
    while (next && doomed.has(next) && !seen.has(next)) {
      seen.add(next)
      next = doomed.get(next)?.carriedFromId ?? null
    }
    if (next === survivor.carriedFromId) continue
    saved.push({ id: survivor.id, carriedFromId: survivor.carriedFromId })
    update.run(next, survivor.id)
  }
  return saved
}

export function restoreCarrySuccessor(db: Database.Database, task: Task): void {
  db.prepare(
    `UPDATE tasks
     SET carriedFromId = @id
     WHERE id = (
       SELECT id FROM tasks
       WHERE chainId = @chainId AND dateCreated > @dateCreated
       ORDER BY dateCreated ASC
       LIMIT 1
     )
     AND carriedFromId IS @predecessor`,
  ).run({
    id: task.id,
    chainId: task.chainId,
    dateCreated: task.dateCreated,
    predecessor: task.carriedFromId,
  })
}
