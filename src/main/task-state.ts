import type Database from 'better-sqlite3'
import { daysBetween } from '../shared/dates.ts'
import type { TaskChainState } from '../shared/types.ts'
import { getDatabase } from './database.ts'

export interface ChainRow {
  id: string
  chainId: string
  dateCreated: string
  dateCompleted: string | null
  droppedAt: string | null
  carriedFromId: string | null
}

interface CarryFacts {
  carriedFromDay: string | null
  carriedDays: number
}

const NO_CARRY: CarryFacts = { carriedFromDay: null, carriedDays: 0 }

export function taskChainStateSql(idCount: number): string {
  const ids = Array.from({ length: idCount }, () => '?').join(', ')
  return `SELECT id, chainId, dateCreated, dateCompleted, droppedAt, carriedFromId
    FROM tasks
    WHERE chainId IN (SELECT chainId FROM tasks WHERE id IN (${ids}))
    ORDER BY chainId, dateCreated, rowid`
}

function byEventDate(a: ChainRow, b: ChainRow, field: 'dateCompleted' | 'droppedAt'): number {
  const left = a[field] ?? ''
  const right = b[field] ?? ''
  return left.localeCompare(right) || a.dateCreated.localeCompare(b.dateCreated) || a.id.localeCompare(b.id)
}

function carryFacts(task: ChainRow, chain: ChainRow[]): CarryFacts {
  if (task.carriedFromId === null) return NO_CARRY
  const source = chain.find((row) => row.id === task.carriedFromId) ?? nearestEarlier(task, chain)
  const origin = chain[0]
  const carriedDays = origin ? Math.max(0, daysBetween(origin.dateCreated, task.dateCreated)) : 0
  return { carriedFromDay: source?.dateCreated ?? null, carriedDays }
}

function nearestEarlier(task: ChainRow, chain: ChainRow[]): ChainRow | undefined {
  let nearest: ChainRow | undefined
  for (const row of chain) {
    if (row.dateCreated >= task.dateCreated) continue
    if (!nearest || row.dateCreated >= nearest.dateCreated) nearest = row
  }
  return nearest
}

function deriveState(task: ChainRow, chain: ChainRow[]): TaskChainState {
  const carry = carryFacts(task, chain)
  if (task.dateCompleted !== null) {
    return {
      id: task.id,
      state: 'done',
      date: task.dateCompleted,
      copyId: task.id,
      copyDate: task.dateCreated,
      ...carry,
    }
  }
  if (task.droppedAt !== null) {
    return {
      id: task.id,
      state: 'dropped',
      date: task.droppedAt,
      copyId: task.id,
      copyDate: task.dateCreated,
      ...carry,
    }
  }
  const later = chain.filter((row) => row.dateCreated > task.dateCreated)
  const finished = later
    .filter((row) => row.dateCompleted !== null)
    .sort((a, b) => byEventDate(a, b, 'dateCompleted'))[0]
  if (finished?.dateCompleted) {
    return {
      id: task.id,
      state: 'finished-later',
      date: finished.dateCompleted,
      copyId: finished.id,
      copyDate: finished.dateCreated,
      ...carry,
    }
  }
  const dropped = later
    .filter((row) => row.droppedAt !== null)
    .sort((a, b) => byEventDate(a, b, 'droppedAt'))[0]
  if (dropped?.droppedAt) {
    return {
      id: task.id,
      state: 'dropped',
      date: dropped.droppedAt,
      copyId: dropped.id,
      copyDate: dropped.dateCreated,
      ...carry,
    }
  }
  return { id: task.id, state: 'open', date: null, copyId: null, copyDate: null, ...carry }
}

export function deriveChainStates(rows: readonly ChainRow[], ids?: readonly string[]): TaskChainState[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const chains = new Map<string, ChainRow[]>()
  for (const row of rows) {
    const chain = chains.get(row.chainId) ?? []
    chain.push(row)
    chains.set(row.chainId, chain)
  }
  const states: TaskChainState[] = []
  for (const id of ids ?? rows.map((row) => row.id)) {
    const task = byId.get(id)
    if (task) states.push(deriveState(task, chains.get(task.chainId) ?? [task]))
  }
  return states
}

export function readTaskChainStates(db: Database.Database, ids: string[]): TaskChainState[] {
  if (ids.length === 0) return []
  const rows = db.prepare(taskChainStateSql(ids.length)).all(...ids) as ChainRow[]
  return deriveChainStates(rows, ids)
}

export function listTaskChainStates(ids: string[]): TaskChainState[] {
  return readTaskChainStates(getDatabase(), ids)
}
