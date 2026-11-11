import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { carryForward } from '../src/main/carry.ts'
import { applySchema } from '../src/main/schema.ts'
import { removeTask, restoreRemovedOn } from '../src/main/task-delete.ts'
import { isRemovedTasks, type Task } from '../src/shared/types.ts'

const savedNow = process.env.BRANCHLOG_NOW
let db: Database.Database
let dir: string

function insert(text: string, dateCreated: string, overrides: Partial<Task> = {}): string {
  const id = randomUUID()
  const task = {
    id, text, dateCreated, done: false, dateCompleted: null, parentId: null,
    x: 0, y: 0, width: 240, height: 0, side: 'main', orderIndex: 0,
    carriedFromId: null, chainId: id, droppedAt: null, ...overrides,
  }
  db.prepare(
    `INSERT INTO tasks (
       id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex,
       carriedFromId, chainId, droppedAt
     ) VALUES (
       @id, @text, @done, @dateCreated, @dateCompleted, @parentId, @x, @y, @width, @height, @side, @orderIndex,
       @carriedFromId, @chainId, @droppedAt
     )`,
  ).run({ ...task, done: task.done ? 1 : 0 })
  return id
}

function snapshot(): unknown[] {
  return db.prepare('SELECT * FROM tasks ORDER BY id').all()
}

function links(id: string): { parentId: string | null; carriedFromId: string | null } | undefined {
  return db.prepare('SELECT parentId, carriedFromId FROM tasks WHERE id = ?').get(id) as
    | { parentId: string | null; carriedFromId: string | null }
    | undefined
}

test.beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'branchlog-carry-delete-'))
  db = new Database(path.join(dir, 'branchlog.sqlite'))
  db.pragma('foreign_keys = ON')
  applySchema(db)
  process.env.BRANCHLOG_NOW = '2026-11-01T12:00:00'
})

test.afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  if (savedNow === undefined) delete process.env.BRANCHLOG_NOW
  else process.env.BRANCHLOG_NOW = savedNow
})

test('deleting a finished parent preserves later carried branch subtrees and undo restores exact links', () => {
  const parent = insert('finished parent', '2026-11-01', { done: true, dateCompleted: '2026-11-01' })
  const branch = insert('branch', '2026-11-01', { parentId: parent, side: 'right', x: 40, y: 80 })
  const child = insert('child', '2026-11-01', { parentId: branch, side: 'right', x: 100, y: 120 })
  process.env.BRANCHLOG_NOW = '2026-11-02T12:00:00'
  const day2 = carryForward(db).tasks
  process.env.BRANCHLOG_NOW = '2026-11-03T12:00:00'
  const day3 = carryForward(db).tasks
  const branch2 = day2.find((task) => task.chainId === branch)!
  const child2 = day2.find((task) => task.chainId === child)!
  const branch3 = day3.find((task) => task.chainId === branch)!
  const child3 = day3.find((task) => task.chainId === child)!
  const newChild = insert('new child of carried branch', '2026-11-03', { parentId: branch2.id })
  const ordinary = insert('ordinary cross-day branch', '2026-11-03', { parentId: parent })
  const ordinaryChild = insert('ordinary descendant', '2026-11-04', { parentId: ordinary })
  const commentId = randomUUID()
  db.prepare('INSERT INTO mapPositions (taskId, x, y) VALUES (?, 12, 18)').run(branch2.id)
  db.prepare(
    `INSERT INTO aiComments (id, taskId, side, text, createdAt)
     VALUES (?, ?, 'left', 'Keep this note', '2026-11-02T12:00:00.000Z')`,
  ).run(commentId, branch2.id)
  const before = snapshot()
  const positions = db.prepare('SELECT * FROM mapPositions').all()
  const comments = db.prepare('SELECT * FROM aiComments').all()

  const { removed } = removeTask(db, parent)
  expect(removed.tasks.map((task) => task.id).sort()).toEqual([parent, branch, child, ordinary, ordinaryChild].sort())
  expect(removed.parentLinks).toEqual(expect.arrayContaining([
    { id: branch2.id, parentId: parent }, { id: branch3.id, parentId: parent },
  ]))
  expect(removed.parentLinks).toHaveLength(2)
  expect(links(branch2.id)).toEqual({ parentId: null, carriedFromId: null })
  expect(links(branch3.id)).toEqual({ parentId: null, carriedFromId: branch2.id })
  expect(links(child2.id)).toEqual({ parentId: branch2.id, carriedFromId: null })
  expect(links(child3.id)).toEqual({ parentId: branch3.id, carriedFromId: child2.id })
  expect(links(newChild)?.parentId).toBe(branch2.id)
  expect(db.prepare('SELECT * FROM mapPositions').all()).toEqual(positions)
  expect(db.prepare('SELECT * FROM aiComments').all()).toEqual(comments)
  expect(db.pragma('foreign_key_check')).toEqual([])
  const deleted = snapshot()

  expect(isRemovedTasks(removed)).toBe(true)
  restoreRemovedOn(db, removed)
  expect(snapshot()).toEqual(before)
  expect(db.pragma('foreign_key_check')).toEqual([])
  const { removed: redone } = removeTask(db, parent)
  expect(snapshot()).toEqual(deleted)
  restoreRemovedOn(db, redone)
  expect(snapshot()).toEqual(before)
})

test('explicitly deleting a middle carried copy removes its same-day carried branches only', () => {
  const parent = insert('parent', '2026-11-01')
  const branch = insert('branch', '2026-11-01', { parentId: parent, side: 'right' })
  process.env.BRANCHLOG_NOW = '2026-11-02T12:00:00'
  const day2 = carryForward(db).tasks
  process.env.BRANCHLOG_NOW = '2026-11-03T12:00:00'
  const day3 = carryForward(db).tasks
  const parent2 = day2.find((task) => task.chainId === parent)!
  const branch2 = day2.find((task) => task.chainId === branch)!
  const parent3 = day3.find((task) => task.chainId === parent)!
  const branch3 = day3.find((task) => task.chainId === branch)!
  const before = snapshot()

  const { removed } = removeTask(db, parent2.id)
  expect(removed.tasks.map((task) => task.id).sort()).toEqual([parent2.id, branch2.id].sort())
  expect(removed.parentLinks).toEqual([])
  expect(links(parent3.id)).toEqual({ parentId: null, carriedFromId: parent })
  expect(links(branch3.id)).toEqual({ parentId: parent3.id, carriedFromId: branch })
  expect(links(parent)).toBeDefined()
  expect(links(branch)).toBeDefined()
  restoreRemovedOn(db, removed)
  expect(snapshot()).toEqual(before)
})

test('a carry whose predecessor was deleted remains protected by its chain identity', () => {
  const parent = insert('parent', '2026-11-01')
  const chainId = randomUUID()
  const copy = insert('surviving head', '2026-11-02', { parentId: parent, chainId, carriedFromId: null })
  const child = insert('subtree', '2026-11-02', { parentId: copy, side: 'right' })
  const before = snapshot()
  const { removed } = removeTask(db, parent)
  expect(removed.tasks.map((task) => task.id)).toEqual([parent])
  expect(links(copy)).toEqual({ parentId: null, carriedFromId: null })
  expect(links(child)?.parentId).toBe(copy)
  restoreRemovedOn(db, removed)
  expect(snapshot()).toEqual(before)
})

test('deletion reply guards require saved parent links with string identities', () => {
  const parent = insert('parent', '2026-11-01')
  const copy = insert('copy', '2026-11-02', { parentId: parent, chainId: randomUUID() })
  const { removed } = removeTask(db, parent)
  expect(removed.parentLinks).toEqual([{ id: copy, parentId: parent }])
  expect(isRemovedTasks(removed)).toBe(true)
  expect(isRemovedTasks({ ...removed, parentLinks: undefined })).toBe(false)
  expect(isRemovedTasks({ ...removed, parentLinks: [{ id: copy, parentId: 1 }] })).toBe(false)
})
