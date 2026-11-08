import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, writeTask } from './launch'

const first = new Date(2026, 0, 15, 12, 0, 0).toISOString()
const later = new Date(2026, 0, 18, 12, 0, 0).toISOString()

interface SavedTask {
  text: string
  dateCompleted: string | null
}

function savedTasks(userData: string): SavedTask[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db.prepare(`SELECT text, dateCompleted FROM tasks ORDER BY dateCreated`).all() as SavedTask[]
  db.close()
  return rows
}

function dateField(page: Page) {
  return page.getByRole('textbox', { name: 'Choose a date' })
}

function cell(page: Page, date: string) {
  return page.locator(`[data-testid="activity-grid"] [data-date="${date}"]`)
}

async function openCalendar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Calendar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible()
}

test('the calendar lights the days a task was completed, and a click opens that day', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: first } })
  let app: ElectronApplication = opened.app
  const userData = opened.userData
  try {
    await writeTask(opened.page, 'origin')
    await opened.page.getByRole('checkbox', { name: 'Mark task done' }).click()
    await expect
      .poll(() => savedTasks(userData))
      .toEqual([expect.objectContaining({ text: 'origin', dateCompleted: '2026-01-15' })])
    await closeApp(app, userData, true)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: later } })
    app = restarted.app
    const page = restarted.page
    await writeTask(page, 'next step')
    await page
      .locator('[data-task-text]', { hasText: /^next step$/ })
      .locator('xpath=../..')
      .getByRole('checkbox', { name: 'Mark task done' })
      .click()
    await expect
      .poll(() => savedTasks(userData).map((row) => row.dateCompleted))
      .toEqual(['2026-01-15', '2026-01-18'])

    const menu = await app.evaluate(({ Menu }) => {
      const go = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Go')
      const item = go?.submenu?.items.find((entry) => entry.label === 'Calendar')
      return item?.enabled ?? false
    })
    expect(menu).toBe(true)

    await openCalendar(page)
    const grid = page.locator('[data-testid="activity-grid"]')
    await expect(grid.locator('button[data-date]')).toHaveCount(53 * 7)
    await expect(cell(page, '2026-01-15')).toHaveAttribute('data-active', 'true')
    await expect(cell(page, '2026-01-18')).toHaveAttribute('data-active', 'true')
    await expect(cell(page, '2026-01-16')).toHaveAttribute('data-active', 'false')

    await cell(page, '2026-01-15').hover()
    await expect(grid.getByRole('status')).toHaveText('Jan 15, 2026 · 1 task completed')
    await grid.locator('button[data-date]').first().hover()
    const tipBox = await grid.getByRole('status').boundingBox()
    expect(tipBox?.x ?? -1).toBeGreaterThanOrEqual(0)
    await cell(page, '2026-01-18').hover()
    await expect(grid.getByRole('status')).toHaveText('Jan 18, 2026 · 1 task completed')
    await cell(page, '2026-01-16').hover()
    await expect(grid.getByRole('status')).toHaveText('Jan 16, 2026 · No tasks completed')

    await cell(page, '2026-01-15').click()
    await expect(grid).toHaveCount(0)
    await expect(dateField(page)).toHaveValue('2026-01-15')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thursday, January 15')
    await expect(page.locator('[data-task-text]')).toHaveText('origin')

    await openCalendar(page)
    await page.keyboard.press('Escape')
    await expect(grid).toHaveCount(0)
    await expect(dateField(page)).toHaveValue('2026-01-15')
  } finally {
    await closeApp(app, userData)
  }
})
