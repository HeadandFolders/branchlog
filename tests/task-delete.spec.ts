import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

function openDb(userData: string): Database.Database {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  return db
}

async function deleteMainTask(page: Page, text: string): Promise<void> {
  const task = page.locator('[data-task-text]', { hasText: text })
  await task.click()
  await task.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
}

test.describe('deleting a task removes its descendants', () => {
  let app: ElectronApplication
  let page: Page
  let userData = ''

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    page = launched.page
    userData = launched.userData
  })

  test.afterEach(async () => {
    await closeApp(app, userData)
  })

  test('select all and backspace twice deletes an empty branch and ctrl n still creates', async () => {
    await writeTask(page, 'Parent')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await expect(page.locator('.react-flow__node-branch [data-task-text]')).toHaveText('')

    const parent = page.locator('.task-list [data-task-text]')
    await parent.click()
    await page.locator('.task-list').evaluate((list) => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      for (const node of list.querySelectorAll<HTMLElement>('[data-task-text]')) {
        node.contentEditable = 'false'
      }
      const range = document.createRange()
      range.selectNodeContents(list)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      const backspace = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      list.dispatchEvent(backspace)
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    })

    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('Deleted 2 tasks. Undo')
    await page.keyboard.press(`${modifier}+N`)
    await expect(page.locator('.task-list [data-task-text]')).toHaveCount(1)
    await expect(page.locator('.task-list [data-task-text]')).toHaveText('')
  })

  test('backspace twice deletes the first of two carried tasks with its branch', async () => {
    await closeApp(app, userData, true)
    let launched = await launchApp(userData, { env: { BRANCHLOG_NOW: '2026-11-08T12:00:00' } })
    app = launched.app
    page = launched.page
    await writeTask(page, 'First carried')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second carried')
    await expect(page.locator('.task-list [data-task-text]')).toHaveText(['First carried', 'Second carried'])
    await closeApp(app, userData, true)

    launched = await launchApp(userData, { env: { BRANCHLOG_NOW: '2026-11-09T12:00:00' } })
    app = launched.app
    page = launched.page
    const main = page.locator('.task-list [data-task-text]')
    await expect(main).toHaveText(['First carried', 'Second carried'])
    await page.locator('.task-list').getByRole('button', { name: 'Branch from this task' }).first().click()
    const branch = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branch).toHaveText('')

    await main.first().click()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press('Backspace')
    await expect(main.first()).toHaveText('')
    await expect(branch).toHaveCount(1)
    await page.keyboard.press('Backspace')

    await expect(main).toHaveText(['Second carried'])
    await expect(branch).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('Deleted 2 tasks. Undo')
  })

  test('deleting an empty task with a resolved comment and reply still works', async () => {
    await writeTask(page, 'Parent')
    const parent = page.locator('.task-list [data-task-text]')
    const parentId = await parent.getAttribute('data-task-id')
    if (!parentId) throw new Error('Parent id is missing')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press('Backspace')
    await expect(parent).toHaveText('')
    const db = openDb(userData)
    const commentId = crypto.randomUUID()
    db.prepare(
      `INSERT INTO aiComments (
         id, taskId, side, type, text, status, keptRanges, x, y, createdAt
       ) VALUES (?, ?, 'left', 'remark', 'Resolved note', 'resolved', '[]', 0, 0, '2026-11-09T00:00:00.000Z')`,
    ).run(commentId, parentId)
    db.prepare(
      `INSERT INTO aiReplies (id, commentId, role, text, keptRanges, createdAt)
       VALUES (?, ?, 'ai', 'Reply', '[]', '2026-11-09T00:01:00.000Z')`,
    ).run(crypto.randomUUID(), commentId)
    db.close()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Reopen AI comment' })).toBeVisible()
    await page.locator('.task-list [data-task-text]').click()
    await page.keyboard.press('Backspace')
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')
    await page.keyboard.press(`${modifier}+N`)
    await expect(page.locator('.task-list [data-task-text]')).toHaveCount(1)
  })

  test('deleting a leaf removes it, and undo puts it back', async () => {
    await writeTask(page, 'Keep')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branch = page.locator('.react-flow__node-branch')
    await expect(branch).toHaveCount(1)
    await branch.getByRole('button', { name: 'Delete' }).click()
    await expect(branch).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(branch).toHaveCount(1)
    await expect(page.locator('[data-task-text]', { hasText: 'Keep' })).toBeVisible()
  })

  test('deleting a parent removes two levels of children, and undo puts them back', async () => {
    await writeTask(page, 'Parent')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branches = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branches.nth(0)).toBeVisible()
    await page.keyboard.type('Child')
    await expect(branches.nth(0)).toHaveText('Child')
    await page.locator('.react-flow__node-branch').nth(0).getByRole('button', { name: 'Branch from this task' }).click()
    await expect(branches.nth(1)).toBeVisible()
    await page.keyboard.type('Grandchild')
    await expect(branches.nth(1)).toHaveText('Grandchild')
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(2)
    await deleteMainTask(page, 'Parent')
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('Deleted 3 tasks. Undo')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('[data-task-text]').filter({ hasText: /^Child$/ })).toBeVisible()
    await expect(page.locator('[data-task-text]').filter({ hasText: /^Grandchild$/ })).toBeVisible()
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(2)
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  })

  test('deleting a parent removes a child on another day, and undo restores the link and position', async () => {
    await writeTask(page, 'Parent')
    const parentId = await page.locator('[data-task-text]').first().getAttribute('data-task-id')
    if (!parentId) throw new Error('Parent id is missing')
    const childId = crypto.randomUUID()
    const grandId = crypto.randomUUID()
    const commentId = crypto.randomUUID()
    const replyId = crypto.randomUUID()
    const db = openDb(userData)
    db.pragma('foreign_keys = ON')
    const insertTask = db.prepare(
      `INSERT INTO tasks (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, side, orderIndex
       ) VALUES (?, ?, 0, ?, NULL, ?, ?, ?, 'right', 0)`,
    )
    insertTask.run(childId, 'Child', '2020-03-04', parentId, 30, 50)
    insertTask.run(grandId, 'Grandchild', '2020-04-05', childId, 80, 90)
    db.prepare('INSERT INTO mapPositions (taskId, x, y) VALUES (?, ?, ?)').run(childId, 12, 18)
    db.prepare(
      `INSERT INTO aiComments (
         id, taskId, side, text, status, keptRanges, x, y, createdAt
       ) VALUES (?, ?, 'left', 'A note', 'open', '[]', 0, 0, '2020-03-04T00:00:00.000Z')`,
    ).run(commentId, childId)
    db.prepare(
      `INSERT INTO aiReplies (id, commentId, role, text, createdAt)
       VALUES (?, ?, 'ai', 'A reply', '2020-03-04T00:00:00.000Z')`,
    ).run(replyId, commentId)
    db.close()

    await deleteMainTask(page, 'Parent')
    await expect(page.getByRole('status')).toHaveText('Deleted 3 tasks. Undo')
    const deleted = openDb(userData)
    const gone = deleted.prepare('SELECT COUNT(*) AS n FROM tasks WHERE id IN (?, ?, ?)').get(parentId, childId, grandId) as {
      n: number
    }
    const comments = deleted.prepare('SELECT COUNT(*) AS n FROM aiComments').get() as { n: number }
    const replies = deleted.prepare('SELECT COUNT(*) AS n FROM aiReplies').get() as { n: number }
    const positions = deleted.prepare('SELECT COUNT(*) AS n FROM mapPositions').get() as { n: number }
    deleted.close()
    expect(gone.n).toBe(0)
    expect(comments.n).toBe(0)
    expect(replies.n).toBe(0)
    expect(positions.n).toBe(0)

    await page.keyboard.press(`${modifier}+Z`)
    const restored = openDb(userData)
    const child = restored.prepare('SELECT text, parentId, x, y FROM tasks WHERE id = ?').get(childId) as {
      text: string
      parentId: string
      x: number
      y: number
    }
    const grand = restored.prepare('SELECT text, parentId, x, y FROM tasks WHERE id = ?').get(grandId) as {
      text: string
      parentId: string
      x: number
      y: number
    }
    const position = restored.prepare('SELECT x, y FROM mapPositions WHERE taskId = ?').get(childId) as {
      x: number
      y: number
    }
    restored.close()
    expect(child).toEqual({ text: 'Child', parentId, x: 30, y: 50 })
    expect(grand).toEqual({ text: 'Grandchild', parentId: childId, x: 80, y: 90 })
    expect(position).toEqual({ x: 12, y: 18 })

    await page.getByRole('textbox', { name: 'Choose a date' }).fill('2020-03-04')
    await expect(page.locator('[data-task-text]', { hasText: 'Child' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Choose a date' }).fill('2020-04-05')
    await expect(page.locator('[data-task-text]', { hasText: 'Grandchild' })).toBeVisible()
  })
})

test('startup removes tasks whose parent is already gone', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'branchlog-e2e-'))
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('foreign_keys = OFF')
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
      dateCreated TEXT NOT NULL,
      dateCompleted TEXT,
      parentId TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      side TEXT NOT NULL DEFAULT 'main' CHECK (side IN ('main', 'right')),
      orderIndex INTEGER NOT NULL DEFAULT 0
    );
  `)
  const insert = db.prepare(
    `INSERT INTO tasks (
       id, text, done, dateCreated, dateCompleted, parentId, x, y, side, orderIndex
     ) VALUES (?, ?, 0, ?, NULL, ?, ?, ?, ?, 0)`,
  )
  insert.run('keeper', 'Kept', '2024-05-01', null, 0, 0, 'main')
  insert.run('child', 'Child', '2024-06-01', 'keeper', 30, 50, 'right')
  insert.run('orphan', 'Orphan', '2024-06-02', 'missing-parent', 4, 8, 'right')
  insert.run('grand', 'Grand', '2024-06-03', 'orphan', 9, 10, 'right')
  db.close()

  const launched = await launchApp(userData)
  try {
    const check = openDb(userData)
    const schema = check.prepare(`SELECT sql FROM sqlite_master WHERE name = 'tasks'`).get() as { sql: string }
    const rows = check.prepare('SELECT id, parentId, x, y FROM tasks ORDER BY id').all() as {
      id: string
      parentId: string | null
      x: number
      y: number
    }[]
    const flag = check.prepare(`SELECT value FROM settings WHERE key = 'orphanCleanup'`).get() as { value: string }
    check.close()
    expect(schema.sql).toContain('ON DELETE CASCADE')
    expect(schema.sql).not.toContain('tasks_next')
    expect(rows).toEqual([
      { id: 'child', parentId: 'keeper', x: 30, y: 50 },
      { id: 'keeper', parentId: null, x: 0, y: 0 },
    ])
    expect(flag.value).toBe('1')
  } finally {
    await closeApp(launched.app, userData)
  }
})
