import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { setTempLog } from '../src/shared/temp-timing.ts'
import { closeDatabase, initDatabase, listTasksByDate } from '../src/main/database.ts'
import { countCommentsOn, insertComment, listCommentsByDate } from '../src/main/ai-store.ts'
import { applySchema } from '../src/main/schema.ts'
import type { AiComment } from '../src/shared/ai-comments.ts'

const DATE = '2026-11-09'
const dirs: string[] = []

function tempUserData(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-ai-perf-'))
  dirs.push(dir)
  return dir
}

function comment(taskId: string, index: number, side: 'left' | 'right' = 'left'): AiComment {
  const id = randomUUID()
  return {
    id,
    taskId,
    side,
    type: 'remark',
    text: `Margin comment ${index} with enough words to be worth reading.`,
    status: 'open',
    keptRanges: '[]',
    x: -300,
    y: index * 90,
    createdAt: '2026-11-09T10:00:00.000Z',
    replies: [],
  }
}

function seedTasks(db: Database.Database, count: number): string[] {
  const ids: string[] = []
  const insert = db.prepare(
    `INSERT INTO tasks (id, text, done, dateCreated, dateCompleted, parentId, side, x, y, width, height, orderIndex, chainId)
     VALUES (?, ?, 0, ?, NULL, NULL, 'main', 0, ?, 0, 0, ?, ?)`,
  )
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const id = randomUUID()
      ids.push(id)
      insert.run(id, `task ${index}`, DATE, index * 40, index, id)
    }
  })()
  return ids
}

function seedComments(db: Database.Database, taskIds: string[], count: number): void {
  const reply = db.prepare(
    `INSERT INTO aiReplies (id, commentId, role, text, keptRanges, createdAt)
     VALUES (?, ?, ?, ?, '[]', '2026-11-09T10:00:00.000Z')`,
  )
  // insertComment runs its own transaction, so the seed loop stays outside one.
  for (let index = 0; index < count; index += 1) {
    const one = comment(taskIds[index % taskIds.length], index)
    insertComment(one)
    reply.run(randomUUID(), one.id, 'user', `My answer ${index}`)
    reply.run(randomUUID(), one.id, 'ai', `Its reply ${index}`)
  }
}

function oldDatabase(dir: string, comments: number): Database.Database {
  const db = new Database(path.join(dir, 'branchlog.sqlite'))
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0,
      dateCreated TEXT NOT NULL, dateCompleted TEXT, parentId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      side TEXT NOT NULL DEFAULT 'main', x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
      orderIndex INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE aiComments (
      id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      side TEXT NOT NULL DEFAULT 'left' CHECK (side IN ('left')),
      text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      keptRanges TEXT NOT NULL DEFAULT '[]', x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE aiReplies (
      id TEXT PRIMARY KEY, commentId TEXT NOT NULL REFERENCES aiComments(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'ai')), text TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE images (
      id TEXT PRIMARY KEY, dateKey TEXT NOT NULL, fileName TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, width REAL NOT NULL DEFAULT 0, height REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  const task = db.prepare(`INSERT INTO tasks (id, text, dateCreated, orderIndex, side) VALUES (?, ?, ?, 0, 'main')`)
  const row = db.prepare(
    `INSERT INTO aiComments (id, taskId, side, text, status, keptRanges, x, y, createdAt)
     VALUES (?, ?, 'left', ?, 'open', '[[0,8]]', -300, ?, '2026-11-09T10:00:00.000Z')`,
  )
  db.transaction(() => {
    task.run('old-task', 'an old task', DATE)
    for (let index = 0; index < comments; index += 1) {
      row.run(randomUUID(), 'old-task', `old comment ${index}`, index * 10)
    }
  })()
  return db
}

test.afterEach(() => {
  closeDatabase()
  setTempLog(() => {})
  delete process.env.BRANCHLOG_MEASURE
})

test.afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

test('boot reports the AI migration as its own step and costs nothing when there is nothing to migrate', () => {
  process.env.BRANCHLOG_MEASURE = '1'
  const marks: { label: string; ms?: number }[] = []
  setTempLog((line) => {
    const parsed = JSON.parse(line.replace('TEMP_MARK ', '')) as { label: string; ms?: number }
    marks.push(parsed)
  })
  initDatabase(tempUserData())
  const boot = marks.filter((mark) => mark.label.startsWith('db-'))
  const steps = ['db-schema', 'db-migrate', 'db-migrate-ai', 'db-migrate-images']
  console.log(`boot steps: ${steps.map((label) => `${label}=${boot.find((mark) => mark.label === label)?.ms}`).join(', ')}`)
  for (const label of steps) {
    expect(boot.map((mark) => mark.label)).toContain(label)
  }
  const ai = boot.find((mark) => mark.label === 'db-migrate-ai')
  expect(ai?.ms).toBeLessThan(25)
})

test('a five-hundred-comment old notebook widens its left-only table at boot within the budget', () => {
  const dir = tempUserData()
  const db = oldDatabase(dir, 500)
  const steps: [string, number][] = []
  const started = performance.now()
  applySchema(db, (step, ms) => steps.push([step, ms]))
  const total = performance.now() - started
  const elapsed = Object.fromEntries(steps)
  console.log(`old notebook boot migration: ${steps.map(([step, ms]) => `${step}=${ms}`).join(', ')}, total ${total.toFixed(1)} ms`)
  expect(elapsed['migrate-ai']).toBeLessThan(400)
  expect(total).toBeLessThan(1000)
  expect(db.prepare('SELECT COUNT(*) AS n FROM aiComments').get()).toEqual({ n: 500 })
  expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'aiComments'").get()).toMatchObject({
    sql: expect.stringContaining("side IN ('left', 'right')"),
  })
  db.close()
})

test('opening a day reads its comments and replies with the tasks, in two queries, inside the budget', () => {
  const db = initDatabase(tempUserData())
  const ids = seedTasks(db, 200)
  seedComments(db, ids, 60)

  // Warm prepare and the page cache, then time the reads the app actually makes.
  listTasksByDate(DATE)
  listCommentsByDate(DATE)

  let prepared = 0
  const prepare = db.prepare.bind(db)
  db.prepare = ((sql: string) => {
    prepared += 1
    return prepare(sql)
  }) as Database.Database['prepare']

  const started = performance.now()
  const tasks = listTasksByDate(DATE)
  const comments = listCommentsByDate(DATE)
  const elapsed = performance.now() - started
  db.prepare = prepare

  console.log(
    `day load with 200 tasks and 60 comments x 2 replies: ${elapsed.toFixed(1)} ms, ${tasks.length} tasks, ${comments.length} comments, ${prepared} queries`,
  )
  expect(tasks).toHaveLength(200)
  expect(comments).toHaveLength(60)
  expect(comments[0]?.replies).toHaveLength(2)
  expect(prepared).toBeLessThanOrEqual(3)
  expect(elapsed).toBeLessThan(150)
})

test('the daily comment cap is one indexed count over five hundred comments', () => {
  const db = initDatabase(tempUserData())
  const ids = seedTasks(db, 250)
  seedComments(db, ids, 500)

  const plan = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM aiComments c JOIN tasks t ON t.id = c.taskId
       WHERE t.dateCreated = ? AND c.side = 'left'`,
    )
    .all(DATE)
  const planned = JSON.stringify(plan)
  countCommentsOn(DATE)
  const started = performance.now()
  const count = countCommentsOn(DATE)
  const elapsed = performance.now() - started
  console.log(`countCommentsOn with ${count} left comments: ${elapsed.toFixed(1)} ms, plan ${planned}`)
  expect(count).toBe(500)
  expect(planned, planned).toContain('idx_tasks_date')
  expect(elapsed).toBeLessThan(40)
})
