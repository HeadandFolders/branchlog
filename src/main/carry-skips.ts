import type Database from 'better-sqlite3'
import { localDateKey, now } from '../shared/dates.ts'

export interface DeletedCopy {
  id: string
  chainId: string
  dateCreated: string
}

function marks(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function moveSkipKeys(db: Database.Database, from: string, to: string): void {
  if (from === to) return
  db.prepare(
    `DELETE FROM carrySkips
     WHERE chainId = ? AND dateKey IN (SELECT dateKey FROM carrySkips WHERE chainId = ?)`,
  ).run(from, to)
  db.prepare('UPDATE carrySkips SET chainId = ? WHERE chainId = ?').run(to, from)
}

// A chain is keyed by its first copy. When that row is deleted the survivors take the
// earliest of their own ids as the key, and the skips move with them.
function rekeyChain(db: Database.Database, oldKey: string): string | null {
  const next = db
    .prepare('SELECT id FROM tasks WHERE chainId = ? ORDER BY dateCreated ASC, rowid ASC LIMIT 1')
    .get(oldKey) as { id: string } | undefined
  if (!next) return null
  db.prepare('UPDATE tasks SET chainId = ? WHERE chainId = ?').run(next.id, oldKey)
  moveSkipKeys(db, oldKey, next.id)
  return next.id
}

/**
 * Records that the user removed these copies for their own day, so the engine never writes
 * that day again for that chain. A chain whose last copy went away keeps no skip.
 * Answers with the key each deleted chain now lives under, or null when the chain is gone.
 */
export function recordSkipsForDeleted(
  db: Database.Database,
  deleted: readonly DeletedCopy[],
): Map<string, string | null> {
  const keys = new Map<string, string | null>()
  if (deleted.length === 0) return keys

  const dates = new Map<string, Set<string>>()
  for (const copy of deleted) {
    const chain = dates.get(copy.chainId) ?? new Set<string>()
    chain.add(copy.dateCreated)
    dates.set(copy.chainId, chain)
  }

  const alive = db.prepare('SELECT 1 AS ok FROM tasks WHERE chainId = ? LIMIT 1')
  const removeSkips = db.prepare('DELETE FROM carrySkips WHERE chainId = ?')
  const insertSkip = db.prepare(
    'INSERT OR IGNORE INTO carrySkips (chainId, dateKey, createdAt) VALUES (?, ?, ?)',
  )

  for (const [chainId, chainDates] of dates) {
    if (!alive.get(chainId)) {
      removeSkips.run(chainId)
      keys.set(chainId, null)
      continue
    }
    const key = rekeyChain(db, chainId) ?? chainId
    const createdAt = now().toISOString()
    for (const dateCreated of chainDates) insertSkip.run(key, dateCreated, createdAt)
    keys.set(chainId, key)
  }
  return keys
}

function descendantIds(db: Database.Database, rootId: string): string[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE copies(id) AS (
         SELECT ?
         UNION ALL
         SELECT tasks.id FROM tasks JOIN copies ON tasks.carriedFromId = copies.id
       )
       SELECT id FROM copies`,
    )
    .all(rootId) as { id: string }[]
  return rows.map((row) => row.id)
}

/**
 * The inverse of a delete: the restored chain answers to its first copy again, and the
 * skipped day is dropped so the copy the user restored carries on exactly as before.
 */
export function clearSkipsForRestored(db: Database.Database, restored: readonly DeletedCopy[]): void {
  const removeSkip = db.prepare('DELETE FROM carrySkips WHERE chainId = ? AND dateKey = ?')
  const setChain = (ids: string[], key: string): void => {
    db.prepare(`UPDATE tasks SET chainId = ? WHERE id IN (${marks(ids.length)})`).run(key, ...ids)
  }

  for (const task of restored) {
    if (task.id !== task.chainId) continue
    const members = descendantIds(db, task.id)
    if (members.length <= 1) continue
    setChain(members, task.id)
    for (const member of members) {
      if (member !== task.id) moveSkipKeys(db, member, task.id)
    }
  }
  for (const task of restored) removeSkip.run(task.chainId, task.dateCreated)
}

/** Does this chain still hold a copy the engine would carry onto a new day? */
export function chainCarriesOn(db: Database.Database, chainKey: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM tasks
       WHERE chainId = ?
         AND dateCreated < ?
         AND dateCompleted IS NULL
         AND droppedAt IS NULL
         AND TRIM(text) <> ''
       LIMIT 1`,
    )
    .get(chainKey, localDateKey()) as { ok: number } | undefined
  return row !== undefined
}
