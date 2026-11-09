import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type Page } from '@playwright/test'
import { applySchema } from '../src/main/schema.ts'
import type { RemovedTasks, Task } from '../src/shared/types.ts'
import { closeApp, launchApp, modifier } from './launch'

async function deleteParent(page: Page, id: string): Promise<void> {
  await page.locator(`[data-task-text][data-task-id="${id}"]`).click()
  await page.keyboard.press('Backspace')
}

test('deleting a finished parent protects carried subtrees through undo and redo', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'branchlog-e2e-carry-delete-'))
  const file = path.join(userData, 'branchlog.sqlite')
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  applySchema(db)
  const parent = randomUUID()
  const branch = randomUUID()
  const copy2 = randomUUID()
  const copy3 = randomUUID()
  const subtree = randomUUID()
  const ordinary = randomUUID()
  const insert = db.prepare(
    `INSERT INTO tasks (id, text, dateCreated, parentId, side, chainId, carriedFromId, orderIndex)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run(parent, '', '2026-11-01', null, 'main', parent, null, 0)
  db.prepare("UPDATE tasks SET done = 1, dateCompleted = '2026-11-01' WHERE id = ?").run(parent)
  insert.run(branch, 'Original branch', '2026-11-01', parent, 'right', branch, null, 0)
  insert.run(copy2, 'Carried branch', '2026-11-02', parent, 'main', branch, branch, 0)
  insert.run(copy3, 'Carried branch', '2026-11-03', parent, 'main', branch, copy2, 0)
  insert.run(subtree, 'Preserved subtree', '2026-11-02', copy2, 'right', subtree, null, 0)
  insert.run(ordinary, 'Ordinary cross-day branch', '2026-11-02', parent, 'main', ordinary, null, 1)
  db.prepare("UPDATE tasks SET x = 600, y = 160 WHERE side = 'right'").run()
  db.prepare("INSERT INTO settings (key, value) VALUES ('autoSeparate', '0')").run()
  db.close()
  const opened = await launchApp(userData, { env: { BRANCHLOG_NOW: '2026-11-01T12:00:00' } })
  const { app, page } = opened
  const snapshot = (): (Omit<Task, 'done'> & { done: number })[] => {
    const read = new Database(file, { readonly: true })
    try {
      return read.prepare('SELECT * FROM tasks ORDER BY id').all() as (Omit<Task, 'done'> & { done: number })[]
    } finally {
      read.close()
    }
  }
  const continuationIds = (date: string): Promise<string[]> => page.evaluate(async (day) => {
    const marks = await window.branchlog.tasks.continuations(day)
    return marks.map((mark) => mark.taskId)
  }, date)
  try {
    await expect(page.locator('[data-task-text]')).toHaveCount(2)
    const before = snapshot()
    await deleteParent(page, parent)
    await expect(page.getByRole('status')).toHaveText('Deleted 3 tasks. Undo')
    const after = snapshot()
    expect(after).toHaveLength(3)
    expect(after).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: copy2, parentId: null, carriedFromId: null }),
      expect.objectContaining({ id: copy3, parentId: null, carriedFromId: copy2 }),
      expect.objectContaining({ id: subtree, parentId: copy2 }),
    ]))
    expect(await continuationIds('2026-11-02')).toEqual([])
    const removed: RemovedTasks = {
      tasks: before.filter((task) => [parent, branch, ordinary].includes(task.id))
        .map((task) => ({ ...task, done: task.done === 1 })),
      mapPositions: [],
      carryLinks: [{ id: copy2, carriedFromId: branch }],
      parentLinks: [{ id: copy2, parentId: parent }, { id: copy3, parentId: parent }],
      comments: [],
    }
    for (const parentLinks of [
      undefined,
      [{ id: 'invalid', parentId: parent }],
      [removed.parentLinks[0], removed.parentLinks[0]],
      [{ id: parent, parentId: parent }],
      [{ id: copy2, parentId: randomUUID() }],
    ]) {
      const result = await page.evaluate((payload) =>
        window.branchlog.tasks.restoreSync(payload as RemovedTasks),
      { ...removed, parentLinks })
      expect(result.ok).toBe(false)
      expect(snapshot()).toEqual(after)
    }

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('[data-task-text]')).toHaveCount(2)
    expect(snapshot()).toEqual(before)
    expect(await continuationIds('2026-11-02')).toEqual([copy2, ordinary])

    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(page.getByRole('status')).toHaveText('Deleted 3 tasks. Undo')
    expect(snapshot()).toEqual(after)
    expect(await continuationIds('2026-11-03')).toEqual([])

    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('[data-task-text]')).toHaveCount(2)
    expect(snapshot()).toEqual(before)
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(page.locator('[data-task-text]', { hasText: /^Carried branch$/ })).toBeVisible()
    await expect(page.locator('[data-task-text]', { hasText: /^Preserved subtree$/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /Continued from an empty task/ })).toHaveCount(2)
  } finally {
    await closeApp(app, userData)
  }
})
