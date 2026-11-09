import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { addDays } from '../src/shared/dates.ts'
import { carryCandidateSql, carryForward, dropTask, readTaskLife, undropTask } from '../src/main/carry.ts'
import { migrateTasks } from '../src/main/migrate.ts'
import { applySchema } from '../src/main/schema.ts'
import { removeTask, restoreRemovedOn } from '../src/main/task-delete.ts'

const savedNow = process.env.BRANCHLOG_NOW
const opened: { db: Database.Database; dir: string }[] = []

interface Row {
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
  carriedFromId: string | null
  chainId: string
  droppedAt: string | null
}

function at(iso: string): void {
  process.env.BRANCHLOG_NOW = iso
}

function restoreClock(): void {
  if (savedNow === undefined) delete process.env.BRANCHLOG_NOW
  else process.env.BRANCHLOG_NOW = savedNow
}

function tempDatabase(): Database.Database {
  const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-carry-'))
  const db = new Database(path.join(dir, 'branchlog.sqlite'))
  db.pragma('foreign_keys = ON')
  opened.push({ db, dir })
  return db
}

function openDb(): Database.Database {
  const db = tempDatabase()
  applySchema(db)
  return db
}

function rows(db: Database.Database): Row[] {
  return db
    .prepare(
      `SELECT id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
              carriedFromId, chainId, droppedAt
       FROM tasks
       ORDER BY dateCreated, side, orderIndex, rowid`,
    )
    .all() as Row[]
}

function on(db: Database.Database, date: string, text?: string): Row[] {
  return rows(db).filter((row) => row.dateCreated === date && (text === undefined || row.text === text))
}

function insert(
  db: Database.Database,
  row: { id?: string; text: string; dateCreated: string } & Partial<Row>,
): string {
  const id = row.id ?? randomUUID()
  db.prepare(
    `INSERT INTO tasks (
       id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
       carriedFromId, chainId, droppedAt
     ) VALUES (
       @id, @text, @done, @dateCreated, @dateCompleted, @parentId, @x, @y, @width, @height, @side, @orderIndex,
       @carriedFromId, @chainId, @droppedAt
     )`,
  ).run({
    id,
    text: row.text,
    done: row.done ?? 0,
    dateCreated: row.dateCreated,
    dateCompleted: row.dateCompleted ?? null,
    parentId: row.parentId ?? null,
    x: row.x ?? 0,
    y: row.y ?? 0,
    width: row.width ?? 240,
    height: row.height ?? 0,
    side: row.side ?? 'main',
    orderIndex: row.orderIndex ?? 0,
    carriedFromId: row.carriedFromId ?? null,
    chainId: row.chainId ?? id,
    droppedAt: row.droppedAt ?? null,
  })
  return id
}

test.afterEach(() => {
  restoreClock()
  for (const item of opened.splice(0, opened.length)) {
    item.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})

test.afterAll(() => {
  restoreClock()
})

test('an unfinished task is copied onto the next day and the original stays', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const first = insert(db, { text: 'first', dateCreated: '2026-11-01', orderIndex: 0, x: 3, y: 4 })
  const second = insert(db, { text: 'second', dateCreated: '2026-11-01', orderIndex: 1 })
  insert(db, { text: 'already', dateCreated: '2026-11-02', orderIndex: 4 })
  insert(db, { text: 'later', dateCreated: '2026-11-03' })
  const before = rows(db).filter((row) => row.dateCreated === '2026-11-01')

  at('2026-11-02T12:00:00')
  const carried = carryForward(db)
  expect(carried.date).toBe('2026-11-02')
  expect(carried.tasks.map((task) => task.text)).toEqual(['first', 'second'])
  expect(on(db, '2026-11-01')).toEqual(before)
  expect(on(db, '2026-11-03').map((row) => row.text)).toEqual(['later'])

  const today = on(db, '2026-11-02')
  expect(today.map((row) => row.text)).toEqual(['already', 'first', 'second'])
  expect(today.map((row) => row.orderIndex)).toEqual([4, 5, 6])
  const copy = today.find((row) => row.text === 'first')
  expect(copy).toMatchObject({
    dateCreated: '2026-11-02',
    dateCompleted: null,
    droppedAt: null,
    done: 0,
    side: 'main',
    parentId: null,
    carriedFromId: first,
    chainId: first,
    x: 3,
    y: 4,
  })
  expect(copy?.id).not.toBe(first)
  expect(today.find((row) => row.text === 'second')?.carriedFromId).toBe(second)
  expect(today.find((row) => row.text === 'already')?.carriedFromId).toBeNull()
})

test('finished, dropped, and old tasks stay where they are', () => {
  const db = openDb()
  at('2026-11-15T12:00:00')
  insert(db, { text: 'done', dateCreated: '2026-11-14', done: 1, dateCompleted: '2026-11-14' })
  const dropped = insert(db, { text: 'dropped', dateCreated: '2026-11-14' })
  dropTask(db, dropped)
  insert(db, { text: 'old', dateCreated: '2026-10-31' })
  insert(db, { text: 'kept', dateCreated: addDays('2026-11-15', -14) })
  const parked = insert(db, { text: 'parked', dateCreated: '2026-11-14', side: 'right', parentId: dropped, x: 8, y: 9 })

  const carried = carryForward(db)
  expect(carried.tasks.map((task) => task.text).sort()).toEqual(['kept', 'parked'])
  expect(on(db, '2026-11-15').find((row) => row.text === 'parked')).toMatchObject({
    side: 'main',
    parentId: dropped,
    x: 8,
    y: 9,
    carriedFromId: parked,
  })
  expect(on(db, '2026-11-15').some((row) => row.text === 'dropped' || row.text === 'done' || row.text === 'old')).toBe(
    false,
  )

  undropTask(db, dropped)
  const again = carryForward(db)
  expect(again.tasks.map((task) => task.text)).toEqual(['dropped'])
  expect(on(db, '2026-11-15').filter((row) => row.text === 'dropped')).toHaveLength(1)
})

test('running the engine twice creates one copy', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const id = insert(db, { text: 'once', dateCreated: '2026-11-01' })
  at('2026-11-02T12:00:00')
  expect(carryForward(db).tasks).toHaveLength(1)
  expect(carryForward(db).tasks).toHaveLength(0)
  expect(on(db, '2026-11-02')).toHaveLength(1)
  expect(() => insert(db, { text: 'dup', dateCreated: '2026-11-02', chainId: id })).toThrow()
})

test('a gap of several days copies once onto today', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  insert(db, { text: 'gap', dateCreated: '2026-11-01' })
  at('2026-11-05T12:00:00')
  const carried = carryForward(db)
  expect(carried.tasks).toHaveLength(1)
  expect(carried.tasks[0]?.dateCreated).toBe('2026-11-05')
  const dates = rows(db).map((row) => row.dateCreated)
  expect(dates).toEqual(['2026-11-01', '2026-11-05'])
})

test('a chain across three days keeps one chain id and only the latest copy is live', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const origin = insert(db, { text: 'chain', dateCreated: '2026-11-01' })
  at('2026-11-02T12:00:00')
  carryForward(db)
  at('2026-11-03T12:00:00')
  carryForward(db)

  const chain = rows(db).filter((row) => row.text === 'chain')
  expect(chain.map((row) => row.dateCreated)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
  expect(new Set(chain.map((row) => row.chainId))).toEqual(new Set([origin]))
  expect(chain[1]?.carriedFromId).toBe(origin)
  expect(chain[2]?.carriedFromId).toBe(chain[1]?.id)
  expect(readTaskLife(db, origin)).toMatchObject({ open: false, carried: false, superseded: true, live: false })
  expect(readTaskLife(db, chain[1]?.id ?? '')).toMatchObject({ superseded: true, live: false, carried: true })
  const latest = readTaskLife(db, chain[2]?.id ?? '')
  expect(latest).toMatchObject({ open: true, done: false, dropped: false, carried: true, superseded: false, live: true })
})

test('unfinished branches come along and a branch of a finished parent joins the main list', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const parent = insert(db, { text: 'parent', dateCreated: '2026-11-01', orderIndex: 0 })
  const along = insert(db, {
    text: 'along',
    dateCreated: '2026-11-01',
    side: 'right',
    parentId: parent,
    x: 40,
    y: 80,
    width: 180,
    height: 20,
    orderIndex: 0,
  })
  insert(db, {
    text: 'finished branch',
    dateCreated: '2026-11-01',
    side: 'right',
    parentId: parent,
    done: 1,
    dateCompleted: '2026-11-01',
    x: 1,
    y: 2,
    orderIndex: 1,
  })
  const finishedParent = insert(db, {
    text: 'finished parent',
    dateCreated: '2026-11-01',
    done: 1,
    dateCompleted: '2026-11-01',
    orderIndex: 1,
  })
  const orphan = insert(db, {
    text: 'orphan branch',
    dateCreated: '2026-11-01',
    side: 'right',
    parentId: finishedParent,
    x: 11,
    y: 22,
    orderIndex: 2,
  })

  at('2026-11-02T12:00:00')
  carryForward(db)
  const today = on(db, '2026-11-02')
  expect(today.map((row) => row.text)).toEqual(['parent', 'orphan branch', 'along'])
  const parentCopy = today.find((row) => row.text === 'parent')
  const alongCopy = today.find((row) => row.text === 'along')
  const orphanCopy = today.find((row) => row.text === 'orphan branch')
  expect(parentCopy).toMatchObject({ side: 'main', carriedFromId: parent, chainId: parent, parentId: null })
  expect(alongCopy).toMatchObject({
    side: 'right',
    parentId: parentCopy?.id,
    carriedFromId: along,
    chainId: along,
    x: 40,
    y: 80,
    width: 180,
    height: 20,
  })
  expect(orphanCopy).toMatchObject({
    side: 'main',
    parentId: finishedParent,
    carriedFromId: orphan,
    chainId: orphan,
    x: 11,
    y: 22,
  })
  expect(on(db, '2026-11-01').map((row) => row.text)).toEqual([
    'parent',
    'finished parent',
    'along',
    'finished branch',
    'orphan branch',
  ])
})

test('deleting a middle copy relinks the chain and undo restores it', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const parent = insert(db, { text: 'parent', dateCreated: '2026-11-01' })
  const branch = insert(db, {
    text: 'branch',
    dateCreated: '2026-11-01',
    side: 'right',
    parentId: parent,
    x: 5,
    y: 6,
  })
  at('2026-11-02T12:00:00')
  carryForward(db)
  at('2026-11-03T12:00:00')
  carryForward(db)

  const day2Parent = on(db, '2026-11-02', 'parent')[0]
  const day2Branch = on(db, '2026-11-02', 'branch')[0]
  const day3Parent = on(db, '2026-11-03', 'parent')[0]
  const day3Branch = on(db, '2026-11-03', 'branch')[0]
  if (!day2Parent || !day2Branch || !day3Parent || !day3Branch) throw new Error('chain missing')

  const removed = removeTask(db, day2Parent.id)
  expect(rows(db).map((row) => row.id).sort()).toEqual([parent, branch, day3Parent.id, day3Branch.id].sort())
  expect(on(db, '2026-11-03', 'parent')[0]?.carriedFromId).toBe(parent)
  expect(on(db, '2026-11-03', 'branch')[0]?.carriedFromId).toBe(branch)
  expect(on(db, '2026-11-01')).toHaveLength(2)

  restoreRemovedOn(db, removed)
  expect(on(db, '2026-11-02', 'parent')[0]).toMatchObject({ id: day2Parent.id, carriedFromId: parent, chainId: parent })
  expect(on(db, '2026-11-02', 'branch')[0]).toMatchObject({
    id: day2Branch.id,
    carriedFromId: branch,
    parentId: day2Parent.id,
    x: 5,
    y: 6,
  })
  expect(on(db, '2026-11-03', 'parent')[0]?.carriedFromId).toBe(day2Parent.id)
  expect(on(db, '2026-11-03', 'branch')[0]?.carriedFromId).toBe(day2Branch.id)
  expect(rows(db)).toHaveLength(6)
})

test('autoCarry off copies nothing', () => {
  const db = openDb()
  at('2026-11-02T12:00:00')
  insert(db, { text: 'stay', dateCreated: '2026-11-01' })
  db.prepare(`INSERT INTO settings (key, value) VALUES ('autoCarry', '0')`).run()
  const before = rows(db)
  expect(carryForward(db).tasks).toEqual([])
  expect(rows(db)).toEqual(before)
})

test('migration backfills chainId and can run twice', () => {
  const altered = tempDatabase()
  altered.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
      dateCreated TEXT NOT NULL,
      dateCompleted TEXT,
      parentId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 240,
      height REAL NOT NULL DEFAULT 0,
      side TEXT NOT NULL DEFAULT 'main' CHECK (side IN ('main', 'right')),
      orderIndex INTEGER NOT NULL DEFAULT 0
    );
  `)
  altered.prepare(`INSERT INTO tasks (id, text, dateCreated) VALUES ('alpha', 'old', '2020-01-01')`).run()
  applySchema(altered)
  migrateTasks(altered)
  const alpha = altered.prepare(`SELECT chainId, carriedFromId, droppedAt FROM tasks WHERE id = 'alpha'`).get() as {
    chainId: string
    carriedFromId: string | null
    droppedAt: string | null
  }
  expect(alpha).toEqual({ chainId: 'alpha', carriedFromId: null, droppedAt: null })
  expect(
    altered.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'carryChainBackfill'`).get(),
  ).toEqual({ n: 1 })

  const rebuilt = tempDatabase()
  rebuilt.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0,
      dateCreated TEXT NOT NULL,
      dateCompleted TEXT,
      parentId TEXT,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      side TEXT NOT NULL DEFAULT 'main',
      orderIndex INTEGER NOT NULL DEFAULT 0
    );
  `)
  rebuilt.prepare(`INSERT INTO tasks (id, text, dateCreated) VALUES ('beta', 'older', '2020-02-02')`).run()
  applySchema(rebuilt)
  migrateTasks(rebuilt)
  expect(rebuilt.prepare(`SELECT chainId FROM tasks WHERE id = 'beta'`).get()).toEqual({ chainId: 'beta' })
  const parent = rebuilt.prepare(`PRAGMA foreign_key_list(tasks)`).all() as { from: string; on_delete: string }[]
  expect(parent.find((key) => key.from === 'parentId')?.on_delete.toUpperCase()).toBe('CASCADE')

  rebuilt.prepare(`INSERT INTO tasks (id, text, dateCreated) VALUES ('one', 'a', '2026-11-01')`).run()
  rebuilt.prepare(`INSERT INTO tasks (id, text, dateCreated) VALUES ('two', 'b', '2026-11-01')`).run()
  expect(rebuilt.prepare(`SELECT id, chainId FROM tasks WHERE id IN ('one', 'two') ORDER BY id`).all()).toEqual([
    { id: 'one', chainId: 'one' },
    { id: 'two', chainId: 'two' },
  ])
})

test('five thousand tasks carry on the chain index', () => {
  const db = openDb()
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 2000')
  at('2026-11-01T12:00:00')
  const seed = db.prepare(
    `INSERT INTO tasks (id, text, done, dateCreated, side, orderIndex, chainId)
     VALUES (?, ?, 0, '2026-11-01', 'main', ?, ?)`,
  )
  const write = db.transaction(() => {
    for (let index = 0; index < 5000; index += 1) {
      const id = randomUUID()
      seed.run(id, `task ${index}`, index, id)
    }
  })
  write()
  at('2026-11-02T12:00:00')
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${carryCandidateSql()}`).all({
    today: '2026-11-02',
    start: '2026-10-19',
  })
  const planned = JSON.stringify(plan)
  expect(planned, planned).toContain('idx_tasks_chain_date')

  const carried = carryForward(db)
  console.log(`carry 5000 tasks: ${carried.ms.toFixed(1)} ms`)
  expect(carried.tasks).toHaveLength(5000)
  expect(carried.ms).toBeLessThan(2_000)
  expect(carryForward(db).tasks).toHaveLength(0)
  expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get()).toEqual({ n: 10000 })
})
