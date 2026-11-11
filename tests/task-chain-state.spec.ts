import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { carryForward, dropTask } from '../src/main/carry.ts'
import { applySchema } from '../src/main/schema.ts'
import { readTaskChainStates, taskChainStateSql } from '../src/main/task-state.ts'
import { removeTask, restoreRemovedOn } from '../src/main/task-delete.ts'

const savedNow = process.env.BRANCHLOG_NOW
const opened: { db: Database.Database; dir: string }[] = []

function at(iso: string): void {
  process.env.BRANCHLOG_NOW = iso
}

function openDb(): Database.Database {
  const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-chain-state-'))
  const db = new Database(path.join(dir, 'branchlog.sqlite'))
  db.pragma('foreign_keys = ON')
  applySchema(db)
  opened.push({ db, dir })
  return db
}

function insert(db: Database.Database, dateCreated: string, text = 'chain'): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO tasks (id, text, done, dateCreated, dateCompleted, side, orderIndex, chainId, droppedAt)
     VALUES (?, ?, 0, ?, NULL, 'main', 0, ?, NULL)`,
  ).run(id, text, dateCreated, id)
  return id
}

function carried(db: Database.Database, dateCreated: string): string {
  const row = db.prepare('SELECT id FROM tasks WHERE dateCreated = ?').get(dateCreated) as { id: string } | undefined
  if (!row) throw new Error('Missing carried copy')
  return row.id
}

function finish(db: Database.Database, id: string, date: string | null): void {
  db.prepare('UPDATE tasks SET done = ?, dateCompleted = ? WHERE id = ?').run(date === null ? 0 : 1, date, id)
}

function state(db: Database.Database, id: string) {
  const value = readTaskChainStates(db, [id])[0]
  if (!value) throw new Error('Missing task state')
  return value
}

test.afterEach(() => {
  if (savedNow === undefined) delete process.env.BRANCHLOG_NOW
  else process.env.BRANCHLOG_NOW = savedNow
  for (const item of opened.splice(0, opened.length)) {
    item.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})

test('a later completion derives finished-later without rewriting the earlier copy', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const origin = insert(db, '2026-11-01')
  at('2026-11-02T12:00:00')
  carryForward(db)
  const live = carried(db, '2026-11-02')

  finish(db, live, '2026-11-02')

  expect(state(db, origin)).toEqual({
    id: origin,
    state: 'finished-later',
    date: '2026-11-02',
    copyId: live,
    copyDate: '2026-11-02',
    carriedFromDay: null,
    carriedDays: 0,
  })
  expect(state(db, live)).toMatchObject({ state: 'done', date: '2026-11-02', copyId: live })
  expect(db.prepare('SELECT done, dateCompleted FROM tasks WHERE id = ?').get(origin)).toEqual({
    done: 0,
    dateCompleted: null,
  })
})

test('a three-day chain derives one finishing copy and reopens when it is unchecked', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const first = insert(db, '2026-11-01')
  at('2026-11-02T12:00:00')
  carryForward(db)
  const second = carried(db, '2026-11-02')
  at('2026-11-03T12:00:00')
  carryForward(db)
  const third = carried(db, '2026-11-03')

  finish(db, third, '2026-11-03')
  expect(readTaskChainStates(db, [first, second])).toEqual([
    {
      id: first,
      state: 'finished-later',
      date: '2026-11-03',
      copyId: third,
      copyDate: '2026-11-03',
      carriedFromDay: null,
      carriedDays: 0,
    },
    {
      id: second,
      state: 'finished-later',
      date: '2026-11-03',
      copyId: third,
      copyDate: '2026-11-03',
      carriedFromDay: '2026-11-01',
      carriedDays: 1,
    },
  ])

  finish(db, third, null)
  expect(readTaskChainStates(db, [first, second])).toEqual([
    {
      id: first,
      state: 'open',
      date: null,
      copyId: null,
      copyDate: null,
      carriedFromDay: null,
      carriedDays: 0,
    },
    {
      id: second,
      state: 'open',
      date: null,
      copyId: null,
      copyDate: null,
      carriedFromDay: '2026-11-01',
      carriedDays: 1,
    },
  ])
})

test('the earliest later completion supplies the derived date and copy', () => {
  const db = openDb()
  const first = insert(db, '2026-11-01')
  const second = randomUUID()
  const third = randomUUID()
  db.prepare(
    `INSERT INTO tasks (id, text, done, dateCreated, dateCompleted, side, orderIndex, carriedFromId, chainId)
     VALUES (?, 'chain', 1, '2026-11-02', '2026-11-05', 'main', 0, ?, ?),
            (?, 'chain', 1, '2026-11-03', '2026-11-04', 'main', 0, ?, ?)`,
  ).run(second, first, first, third, second, first)

  expect(state(db, first)).toMatchObject({
    state: 'finished-later',
    date: '2026-11-04',
    copyId: third,
    copyDate: '2026-11-03',
  })
})

test('a finished copy is not carried onto the next day', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  insert(db, '2026-11-01')
  at('2026-11-02T12:00:00')
  carryForward(db)
  finish(db, carried(db, '2026-11-02'), '2026-11-02')

  at('2026-11-03T12:00:00')
  expect(carryForward(db).tasks).toEqual([])
  expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 2 })
})

test('dropping the live copy derives dropped earlier and adds no calendar activity', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const origin = insert(db, '2026-11-01')
  at('2026-11-02T12:00:00')
  carryForward(db)
  const live = carried(db, '2026-11-02')

  dropTask(db, live)

  expect(state(db, origin)).toEqual({
    id: origin,
    state: 'dropped',
    date: '2026-11-02',
    copyId: live,
    copyDate: '2026-11-02',
    carriedFromDay: null,
    carriedDays: 0,
  })
  expect(state(db, live)).toMatchObject({ state: 'dropped', date: '2026-11-02', copyId: live })
  expect(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE dateCompleted IS NOT NULL').get()).toEqual({ n: 0 })
})

test('deleting and restoring the finishing copy changes the derived earlier states', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const first = insert(db, '2026-11-01')
  at('2026-11-02T12:00:00')
  carryForward(db)
  const second = carried(db, '2026-11-02')
  at('2026-11-03T12:00:00')
  carryForward(db)
  const third = carried(db, '2026-11-03')
  finish(db, third, '2026-11-03')

  const { removed } = removeTask(db, third)
  expect(readTaskChainStates(db, [first, second]).map((row) => row.state)).toEqual(['open', 'open'])

  restoreRemovedOn(db, removed)
  expect(readTaskChainStates(db, [first, second]).map((row) => row.state)).toEqual([
    'finished-later',
    'finished-later',
  ])

  removeTask(db, third)
  expect(readTaskChainStates(db, [first, second]).map((row) => row.state)).toEqual(['open', 'open'])
})

test('200 visible tasks use one indexed chain-state query within the time budget', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const seed = db.prepare(
    `INSERT INTO tasks (id, text, done, dateCreated, side, orderIndex, chainId)
     VALUES (?, ?, 0, '2026-11-01', 'main', ?, ?)`,
  )
  const ids: string[] = []
  db.transaction(() => {
    for (let index = 0; index < 200; index += 1) {
      const id = randomUUID()
      ids.push(id)
      seed.run(id, `task ${index}`, index, id)
    }
  })()
  at('2026-11-02T12:00:00')
  carryForward(db)

  const plan = db.prepare(`EXPLAIN QUERY PLAN ${taskChainStateSql(ids.length)}`).all(...ids)
  const planned = JSON.stringify(plan)
  expect(planned, planned).toContain('idx_tasks_chain_date')

  const prepare = db.prepare.bind(db)
  let queries = 0
  db.prepare = ((sql: string) => {
    queries += 1
    return prepare(sql)
  }) as Database.Database['prepare']

  readTaskChainStates(db, ids.slice(0, 1))
  expect(queries).toBe(1)
  queries = 0
  const started = performance.now()
  const states = readTaskChainStates(db, ids)
  const elapsed = performance.now() - started
  console.log(`chain states for 200 tasks: ${elapsed.toFixed(1)} ms, ${queries} query`)
  expect(states).toHaveLength(200)
  expect(queries).toBe(1)
  expect(elapsed).toBeLessThan(250)
})
