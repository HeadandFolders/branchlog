import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

const first = new Date(2026, 0, 15, 12, 0, 0).toISOString()
const later = new Date(2026, 0, 18, 12, 0, 0).toISOString()
const parentWhen = 'Thursday, January 15'

interface SavedTask {
  id: string
  text: string
  dateCreated: string
  parentId: string | null
  side: string
}

function savedTasks(userData: string): SavedTask[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db
    .prepare(
      `SELECT id, text, dateCreated, parentId, side
       FROM tasks
       ORDER BY dateCreated, side, orderIndex`,
    )
    .all() as SavedTask[]
  db.close()
  return rows
}

function dateField(page: Page) {
  return page.getByRole('textbox', { name: 'Choose a date' })
}

async function activeTaskId(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.activeElement instanceof HTMLElement ? (document.activeElement.dataset.taskId ?? '') : '',
  )
}

async function notebookOn(userData: string, now: string): Promise<{ app: ElectronApplication; page: Page }> {
  return launchApp(userData, { env: { BRANCHLOG_NOW: now } })
}

test('the branch dot on an earlier day writes today and leaves that day unchanged', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: first } })
  let app = opened.app
  const userData = opened.userData
  try {
    await writeTask(opened.page, 'origin')
    await expect.poll(() => savedTasks(userData)).toEqual([
      expect.objectContaining({ text: 'origin', dateCreated: '2026-01-15', parentId: null, side: 'main' }),
    ])
    const originId = savedTasks(userData)[0]?.id
    if (!originId) throw new Error('origin id missing')
    await closeApp(app, userData, true)
    const restarted = await notebookOn(userData, later)
    app = restarted.app
    const page = restarted.page
    await expect(dateField(page)).toHaveValue('2026-01-18')
    await dateField(page).fill('2026-01-15')
    await expect(page.locator('[data-task-text]')).toHaveText('origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await expect(dateField(page)).toHaveValue('2026-01-18')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today')
    const mark = page.getByRole('img', { name: `Continued from origin, ${parentWhen}` })
    await expect(mark).toBeVisible()
    await expect(mark).toHaveAttribute('title', `origin\n${parentWhen}`)
    await expect.poll(() => activeTaskId(page)).not.toBe('')
    await page.keyboard.type('next step')
    await expect(page.locator('[data-task-text]')).toHaveText('next step')
    await expect.poll(() => savedTasks(userData)).toEqual([
      expect.objectContaining({ id: originId, text: 'origin', dateCreated: '2026-01-15', parentId: null, side: 'main' }),
      expect.objectContaining({
        text: 'next step',
        dateCreated: '2026-01-18',
        parentId: originId,
        side: 'main',
      }),
    ])
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
    await dateField(page).fill('2026-01-15')
    await expect(page.locator('[data-task-text]')).toHaveText('origin')
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
    await expect(page.getByRole('img', { name: /Continued from/ })).toHaveCount(0)
    await dateField(page).fill('2026-01-18')
    await expect(page.locator('[data-task-text]')).toHaveText('next step')
    await expect(page.getByRole('img', { name: `Continued from origin, ${parentWhen}` })).toBeVisible()
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await expect(dateField(page)).toHaveValue('2026-01-18')
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(1)
  } finally {
    await closeApp(app, userData)
  }
})

test('searching earlier tasks writes a continuation on today, and undo removes it', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: first } })
  let app = opened.app
  const userData = opened.userData
  try {
    await writeTask(opened.page, 'origin')
    await expect.poll(() => savedTasks(userData).some((row) => row.text === 'origin')).toBe(true)
    await closeApp(app, userData, true)
    const restarted = await notebookOn(userData, later)
    app = restarted.app
    const page = restarted.page
    const menu = await app.evaluate(({ Menu }) => {
      const go = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Go')
      const item = go?.submenu?.items.find((entry) => entry.label === 'Branch from an earlier task')
      return {
        enabled: item?.enabled ?? false,
        accelerator: item?.accelerator ?? '',
        registered: item?.registerAccelerator ?? null,
      }
    })
    expect(menu).toEqual({ enabled: true, accelerator: 'CmdOrCtrl+K', registered: false })
    await page.keyboard.press(`${modifier}+K`)
    const search = page.getByRole('textbox', { name: 'Search earlier tasks' })
    await expect(search).toBeFocused()
    await search.fill('ori')
    const option = page.getByRole('option', { name: /origin/ })
    await expect(option).toBeVisible()
    await expect(option).toContainText(parentWhen)
    await page.keyboard.press('Enter')
    await expect(search).toHaveCount(0)
    await expect(page.getByRole('img', { name: `Continued from origin, ${parentWhen}` })).toBeVisible()
    await expect(page.locator('.task-list [data-task-text]')).toHaveCount(1)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect.poll(() => savedTasks(userData).map((row) => row.dateCreated)).toEqual(['2026-01-15'])
    await dateField(page).fill('2026-01-15')
    await expect(page.locator('[data-task-text]')).toHaveText('origin')
  } finally {
    await closeApp(app, userData)
  }
})
