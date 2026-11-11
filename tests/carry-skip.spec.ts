import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { carryForward, dropTask, readTaskLife } from '../src/main/carry.ts'
import { closeDatabase, createTask, initDatabase, updateTask } from '../src/main/database.ts'
import { checkChainIntegrity } from '../src/main/integrity.ts'
import { applySchema } from '../src/main/schema.ts'
import { readTaskChainStates } from '../src/main/task-state.ts'
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

function tempDb(): { db: Database.Database; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-skip-'))
  return { db: new Database(path.join(dir, 'branchlog.sqlite')), dir }
}

function openDb(): Database.Database {
  const fresh = tempDb()
  fresh.db.pragma('foreign_keys = ON')
  applySchema(fresh.db)
  opened.push(fresh)
  return fresh.db
}

// Close and reopen the same file, the way a restart of the app does.
function reopen(db: Database.Database): Database.Database {
  const file = db.name
  db.close()
  const next = new Database(file)
  next.pragma('foreign_keys = ON')
  for (const item of opened) {
    if (item.db === db) item.db = next
  }
  return next
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

function only(db: Database.Database, date: string, text: string): Row {
  const row = on(db, date, text)[0]
  if (!row) throw new Error(`no ${text} on ${date}`)
  return row
}

function skips(db: Database.Database): string[] {
  return db
    .prepare('SELECT chainId, dateKey FROM carrySkips ORDER BY dateKey')
    .all()
    .map((row) => `${(row as { chainId: string }).chainId}:${(row as { dateKey: string }).dateKey}`)
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

// A chain built by the engine itself: the original on day 1, then copies on day 2 and day 3.
function carriedChain(db: Database.Database, text: string): Record<'origin' | 'day2' | 'day3', string> {
  at('2026-11-01T12:00:00')
  const origin = insert(db, { text, dateCreated: '2026-11-01' })
  at('2026-11-02T12:00:00')
  carryForward(db)
  at('2026-11-03T12:00:00')
  carryForward(db)
  return { origin, day2: only(db, '2026-11-02', text).id, day3: only(db, '2026-11-03', text).id }
}

function live(db: Database.Database, id: string): Row | undefined {
  return rows(db).find((row) => row.id === id)
}

test.afterEach(() => {
  restoreClock()
  closeDatabase()
  for (const item of opened.splice(0, opened.length)) {
    try {
      item.db.close()
    } catch {
      // the singleton handle above already closed it
    }
    rmSync(item.dir, { recursive: true, force: true })
  }
})

function restoreClock(): void {
  if (savedNow === undefined) delete process.env.BRANCHLOG_NOW
  else process.env.BRANCHLOG_NOW = savedNow
}

test.afterAll(restoreClock)

test('a deleted copy stays deleted through every engine trigger and a restart', () => {
  let db = openDb()
  const { origin, day2, day3 } = carriedChain(db, 'chain')
  at('2026-11-03T12:00:00')

  const removal = removeTask(db, day3)
  expect(removal.willCarry).toBe(true)
  expect(removal.removed.tasks.map((task) => task.id)).toEqual([day3])
  expect(live(db, day3)).toBeUndefined()
  expect(on(db, '2026-11-01').map((row) => row.id)).toEqual([origin])
  expect(on(db, '2026-11-02').map((row) => row.id)).toEqual([day2])
  expect(skips(db)).toEqual([`${origin}:2026-11-03`])
  expect(checkChainIntegrity(db)).toEqual([])

  for (let run = 0; run < 3; run += 1) {
    expect(carryForward(db).tasks).toEqual([])
  }
  expect(on(db, '2026-11-03')).toEqual([])

  db = reopen(db)
  expect(carryForward(db).tasks).toEqual([])
  expect(rows(db)).toHaveLength(2)
  expect(skips(db)).toEqual([`${origin}:2026-11-03`])
})

test('the next day carries from the latest copy that still exists, and only once', () => {
  const db = openDb()
  const { origin, day2 } = carriedChain(db, 'chain')
  removeTask(db, only(db, '2026-11-03', 'chain').id)

  at('2026-11-04T12:00:00')
  const carried = carryForward(db)
  expect(carried.tasks).toHaveLength(1)
  expect(carried.tasks[0]).toMatchObject({
    text: 'chain',
    dateCreated: '2026-11-04',
    carriedFromId: day2,
    chainId: origin,
  })
  expect(on(db, '2026-11-04')).toHaveLength(1)
  expect(carryForward(db).tasks).toHaveLength(0)
  expect(on(db, '2026-11-04')).toHaveLength(1)
  expect(checkChainIntegrity(db)).toEqual([])
})

test('undo clears the skip and restores the copy, redo deletes it again without a duplicate', () => {
  const db = openDb()
  const { origin, day3 } = carriedChain(db, 'chain')
  at('2026-11-03T12:00:00')
  const before = rows(db)

  const removal = removeTask(db, day3)
  restoreRemovedOn(db, removal.removed)
  expect(rows(db)).toEqual(before)
  expect(skips(db)).toEqual([])
  expect(checkChainIntegrity(db)).toEqual([])

  at('2026-11-04T12:00:00')
  expect(carryForward(db).tasks.map((task) => task.carriedFromId)).toEqual([day3])
  expect(on(db, '2026-11-03', 'chain')).toHaveLength(1)

  const day4 = only(db, '2026-11-04', 'chain')
  const redone = removeTask(db, day4.id)
  expect(redone.willCarry).toBe(true)
  expect(skips(db)).toEqual([`${origin}:2026-11-04`])
  expect(on(db, '2026-11-04')).toEqual([])
  expect(carryForward(db).tasks).toHaveLength(0)
  expect(rows(db).map((row) => row.dateCreated)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
})

test('five days of skipping still carry on day six', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const origin = insert(db, { text: 'defer', dateCreated: '2026-11-01' })

  for (let day = 2; day <= 6; day += 1) {
    const date = `2026-11-0${day}`
    at(`${date}T12:00:00`)
    expect(carryForward(db).tasks).toHaveLength(1)
    const removal = removeTask(db, only(db, date, 'defer').id)
    expect(removal.willCarry, date).toBe(true)
    expect(carryForward(db).tasks).toHaveLength(0)
    expect(on(db, date)).toEqual([])
  }

  expect(rows(db).map((row) => row.dateCreated)).toEqual(['2026-11-01'])
  expect(skips(db)).toEqual([
    `${origin}:2026-11-02`,
    `${origin}:2026-11-03`,
    `${origin}:2026-11-04`,
    `${origin}:2026-11-05`,
    `${origin}:2026-11-06`,
  ])

  at('2026-11-07T12:00:00')
  const carried = carryForward(db)
  expect(carried.tasks).toHaveLength(1)
  expect(carried.tasks[0]).toMatchObject({
    text: 'defer',
    dateCreated: '2026-11-07',
    carriedFromId: origin,
    chainId: origin,
  })
  expect(checkChainIntegrity(db)).toEqual([])
})

test('a chain older than the window ages out and its skip does not stretch the window', () => {
  const db = openDb()
  at('2026-10-01T12:00:00')
  const origin = insert(db, { text: 'stale', dateCreated: '2026-10-01' })
  at('2026-10-02T12:00:00')
  const copy = carryForward(db).tasks[0]
  if (!copy) throw new Error('no copy')
  removeTask(db, copy.id)
  expect(skips(db)).toEqual([`${origin}:2026-10-02`])

  at('2026-11-15T12:00:00')
  expect(carryForward(db).tasks).toEqual([])
  expect(checkChainIntegrity(db)).toEqual([])
})

test('deleting the middle copy relinks the chain and touches no other copy', () => {
  const db = openDb()
  const { origin, day2, day3 } = carriedChain(db, 'chain')
  at('2026-11-03T12:00:00')

  const removal = removeTask(db, day2)
  expect(removal.willCarry).toBe(true)
  expect(live(db, day2)).toBeUndefined()
  expect(live(db, day3)).toMatchObject({ carriedFromId: origin, chainId: origin })
  expect(live(db, origin)?.carriedFromId).toBeNull()
  expect(on(db, '2026-11-01')).toHaveLength(1)
  expect(on(db, '2026-11-03')).toHaveLength(1)
  expect(skips(db)).toEqual([`${origin}:2026-11-02`])
  expect(checkChainIntegrity(db)).toEqual([])

  restoreRemovedOn(db, removal.removed)
  expect(live(db, day2)).toMatchObject({ carriedFromId: origin, chainId: origin })
  expect(live(db, day3)?.carriedFromId).toBe(day2)
  expect(skips(db)).toEqual([])
  expect(checkChainIntegrity(db)).toEqual([])
})

test('deleting the first copy re-keys the chain to the new first copy and moves its skips', () => {
  const db = openDb()
  const { origin, day2, day3 } = carriedChain(db, 'chain')
  at('2026-11-03T12:00:00')
  removeTask(db, day3)
  expect(skips(db)).toEqual([`${origin}:2026-11-03`])

  const removal = removeTask(db, origin)
  expect(removal.willCarry).toBe(false)
  expect(live(db, day2)).toMatchObject({ chainId: day2, carriedFromId: null })
  expect(live(db, day3)).toBeUndefined()
  expect(skips(db)).toEqual([`${day2}:2026-11-01`, `${day2}:2026-11-03`])
  expect(checkChainIntegrity(db)).toEqual([])

  at('2026-11-04T12:00:00')
  const carried = carryForward(db)
  expect(carried.tasks).toHaveLength(1)
  expect(carried.tasks[0]).toMatchObject({ carriedFromId: day2, chainId: day2 })

  restoreRemovedOn(db, removal.removed)
  expect(live(db, day2)?.chainId).toBe(origin)
  expect(live(db, only(db, '2026-11-04', 'chain').id)?.chainId).toBe(origin)
  expect(rows(db).map((row) => row.dateCreated)).toEqual(['2026-11-01', '2026-11-02', '2026-11-04'])
  expect(skips(db)).toEqual([`${origin}:2026-11-03`])
  expect(checkChainIntegrity(db)).toEqual([])
})

test('deleting the only remaining copy removes the chain and its skips', () => {
  const db = openDb()
  const { origin, day2, day3 } = carriedChain(db, 'chain')
  at('2026-11-03T12:00:00')
  expect(removeTask(db, day3).willCarry).toBe(true)
  expect(removeTask(db, day2).willCarry).toBe(true)
  expect(skips(db).sort()).toEqual([`${origin}:2026-11-02`, `${origin}:2026-11-03`].sort())

  const last = removeTask(db, origin)
  expect(last.willCarry).toBe(false)
  expect(rows(db)).toEqual([])
  expect(skips(db)).toEqual([])
  expect(carryForward(db).tasks).toEqual([])
  expect(checkChainIntegrity(db)).toEqual([])
})

test('a deleted copy takes its branches with it and no branch copy is recreated that day', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const parent = insert(db, { text: 'parent', dateCreated: '2026-11-01', orderIndex: 0 })
  const branch = insert(db, {
    text: 'branch',
    dateCreated: '2026-11-01',
    side: 'right',
    parentId: parent,
    orderIndex: 0,
    x: 40,
    y: 80,
  })
  at('2026-11-02T12:00:00')
  carryForward(db)
  at('2026-11-03T12:00:00')
  carryForward(db)
  const day2Parent = only(db, '2026-11-02', 'parent')
  const day2Branch = only(db, '2026-11-02', 'branch')
  const day3Parent = only(db, '2026-11-03', 'parent')
  const day3Branch = only(db, '2026-11-03', 'branch')

  at('2026-11-03T12:00:00')
  const removal = removeTask(db, day3Parent.id)
  expect(removal.willCarry).toBe(true)
  expect(removal.removed.tasks.map((task) => task.id).sort()).toEqual([day3Parent.id, day3Branch.id].sort())
  expect(on(db, '2026-11-03')).toEqual([])
  expect(skips(db).sort()).toEqual([`${parent}:2026-11-03`, `${branch}:2026-11-03`].sort())
  expect(carryForward(db).tasks).toEqual([])
  expect(on(db, '2026-11-03')).toEqual([])
  expect(checkChainIntegrity(db)).toEqual([])

  at('2026-11-04T12:00:00')
  const carried = carryForward(db)
  expect(carried.tasks.map((task) => task.text).sort()).toEqual(['branch', 'parent'])
  const copyParent = only(db, '2026-11-04', 'parent')
  const copyBranch = only(db, '2026-11-04', 'branch')
  expect(copyParent.carriedFromId).toBe(day2Parent.id)
  expect(copyBranch).toMatchObject({ side: 'right', parentId: copyParent.id, carriedFromId: day2Branch.id })
  expect(on(db, '2026-11-04', 'branch')).toHaveLength(1)
  expect(rows(db)).toHaveLength(6)
  expect(checkChainIntegrity(db)).toEqual([])
})

test('deleting a carried copy leaves earlier copies open, never let go', () => {
  const db = openDb()
  const { origin, day2, day3 } = carriedChain(db, 'chain')
  at('2026-11-03T12:00:00')

  const removal = removeTask(db, day3)
  expect(removal.willCarry).toBe(true)
  expect(readTaskChainStates(db, [origin, day2]).map((state) => state.state)).toEqual(['open', 'open'])
  expect(rows(db).map((row) => row.droppedAt)).toEqual([null, null])
  expect(readTaskLife(db, day2)).toMatchObject({ open: true, dropped: false, superseded: false, live: true })
})

test('a let-go task is never carried and a skip never replaces the drop', () => {
  const db = openDb()
  const { day3 } = carriedChain(db, 'chain')
  at('2026-11-03T12:00:00')
  dropTask(db, day3)
  expect(rows(db).map((row) => row.droppedAt)).toEqual([null, null, '2026-11-03'])

  expect(carryForward(db).tasks).toEqual([])
  at('2026-11-04T12:00:00')
  expect(carryForward(db).tasks).toEqual([])
  expect(readTaskChainStates(db, [day3]).map((state) => state.state)).toEqual(['dropped'])

  // Clearing the flag, not an undo of a delete, is what brings the chain back.
  db.prepare('UPDATE tasks SET droppedAt = NULL WHERE id = ?').run(day3)
  expect(carryForward(db).tasks.map((task) => task.text)).toEqual(['chain'])
  expect(checkChainIntegrity(db)).toEqual([])
})

test('writing to a deleted id changes nothing and inserts nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-skip-write-'))
  const notebook = initDatabase(dir)
  opened.push({ db: notebook, dir })
  at('2026-11-02T12:00:00')
  const created = createTask({ id: randomUUID(), text: 'typed', dateCreated: '2026-11-01', afterId: null })
  const carried = carryForward(notebook).tasks[0]
  if (!carried) throw new Error('no copy')

  expect(removeTask(notebook, carried.id).willCarry).toBe(true)
  expect(notebook.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 1 })

  for (const input of [
    { id: carried.id, text: 'late text' },
    { id: carried.id, x: 12, y: 34 },
    { id: carried.id, width: 200, height: 40 },
    { id: carried.id, done: true },
  ]) {
    expect(() => updateTask(input)).toThrow('Invalid task')
  }
  expect(notebook.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 1 })
  expect(rows(notebook).map((row) => row.id)).toEqual([created.id])
  expect(checkChainIntegrity(notebook)).toEqual([])
})

test('the engine ignores a skipped date and still carries every other chain', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  const kept = insert(db, { text: 'kept', dateCreated: '2026-11-01' })
  const hidden = insert(db, { text: 'hidden', dateCreated: '2026-11-01' })
  at('2026-11-03T12:00:00')
  expect(carryForward(db).tasks.map((task) => task.text).sort()).toEqual(['hidden', 'kept'])
  removeTask(db, only(db, '2026-11-03', 'hidden').id)

  expect(carryForward(db).tasks).toEqual([])
  expect(on(db, '2026-11-03').map((row) => row.text)).toEqual(['kept'])

  at('2026-11-04T12:00:00')
  const next = carryForward(db)
  expect(next.tasks.map((task) => task.text).sort()).toEqual(['hidden', 'kept'])
  expect(next.tasks.find((task) => task.text === 'hidden')).toMatchObject({ chainId: hidden, carriedFromId: hidden })
  expect(checkChainIntegrity(db)).toEqual([])
})

test('fifty deletes across five carried days leave exactly the expected rows', () => {
  const db = openDb()
  at('2026-11-01T12:00:00')
  for (let index = 0; index < 50; index += 1) {
    insert(db, { text: `task ${index}`, dateCreated: '2026-11-01', orderIndex: index })
  }
  for (let day = 2; day <= 5; day += 1) {
    at(`2026-11-0${day}T12:00:00`)
    expect(carryForward(db).tasks).toHaveLength(50)
  }
  expect(rows(db)).toHaveLength(250)

  at('2026-11-05T12:00:00')
  for (const row of on(db, '2026-11-05').slice(0, 40)) {
    expect(removeTask(db, row.id).willCarry).toBe(true)
  }
  expect(on(db, '2026-11-05')).toHaveLength(10)
  expect(skips(db)).toHaveLength(40)
  expect(carryForward(db).tasks).toHaveLength(0)
  expect(carryForward(db).tasks).toHaveLength(0)
  expect(on(db, '2026-11-05')).toHaveLength(10)

  at('2026-11-06T12:00:00')
  expect(carryForward(db).tasks).toHaveLength(50)
  const after = rows(db)
  expect(after).toHaveLength(260)
  expect(after.filter((row) => row.dateCreated === '2026-11-05')).toHaveLength(10)
  expect(after.filter((row) => row.dateCreated === '2026-11-06')).toHaveLength(50)
  expect(new Set(after.map((row) => row.chainId)).size).toBe(50)

  const reloaded = reopen(db)
  expect(reloaded.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 260 })
  expect(reloaded.prepare('SELECT COUNT(*) AS n FROM carrySkips').get()).toEqual({ n: 40 })
  expect(checkChainIntegrity(reloaded)).toEqual([])
})
