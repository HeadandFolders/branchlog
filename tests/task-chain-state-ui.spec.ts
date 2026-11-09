import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

const day1 = '2026-11-01T12:00:00'
const day2 = '2026-11-02T12:00:00'

interface SavedTask {
  id: string
  text: string
  done: number
  dateCreated: string
  dateCompleted: string | null
  carriedFromId: string | null
  chainId: string
  droppedAt: string | null
}

function saved(userData: string): SavedTask[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db
    .prepare(
      `SELECT id, text, done, dateCreated, dateCompleted, carriedFromId, chainId, droppedAt
       FROM tasks ORDER BY dateCreated, rowid`,
    )
    .all() as SavedTask[]
  db.close()
  return rows
}

function taskRow(page: Page, text: string) {
  return page.locator('[data-task-text]', { hasText: new RegExp(`^${text}$`) }).locator('xpath=../..')
}

function dateField(page: Page) {
  return page.getByRole('textbox', { name: 'Choose a date' })
}

async function jumpTo(app: ElectronApplication, page: Page, iso: string): Promise<void> {
  await page.evaluate((next) => {
    const url = new URL(window.location.href)
    url.searchParams.set('branchlogNow', next)
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, iso)
  await app.evaluate(({ powerMonitor }, next) => {
    process.env.BRANCHLOG_NOW = next
    powerMonitor.emit('resume')
  }, iso)
}

async function openCalendar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Calendar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible()
}

test('an earlier copy is checked read-only navigation, and undo follows the live copy', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'follow through')
    await expect.poll(() => saved(userData).map((row) => row.text)).toEqual(['follow through'])
    await jumpTo(app, page, day2)
    await page.getByRole('button', { name: 'Next day' }).click()
    const liveRow = taskRow(page, 'follow through')
    await expect(liveRow).toHaveAttribute('data-state', 'open')
    await liveRow.getByRole('checkbox', { name: 'Mark task done' }).click()
    await expect(liveRow).toHaveAttribute('data-state', 'done')
    await expect.poll(() => saved(userData).map((row) => row.dateCompleted)).toEqual([null, '2026-11-02'])

    await page.getByRole('button', { name: 'Previous day' }).click()
    const earlierRow = taskRow(page, 'follow through')
    await expect(earlierRow).toHaveAttribute('data-state', 'finished-later')
    const finished = earlierRow.getByRole('checkbox', {
      name: 'Finished Nov 2. Activate to open.',
    })
    await expect(finished).toHaveAttribute('aria-checked', 'true')
    await expect(finished).toHaveAttribute('aria-readonly', 'true')
    const beforeOpen = saved(userData)
    await finished.click()
    await expect(dateField(page)).toHaveValue('2026-11-02')
    await expect(page.locator('[data-task-text]')).toBeFocused()
    expect(saved(userData)).toEqual(beforeOpen)

    await page.keyboard.press('End')
    await page.keyboard.type(' edited')
    await expect(page.locator('[data-task-text]')).toHaveText('follow through edited')
    await expect.poll(() => saved(userData)[1]?.text).toBe('follow through edited')
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.locator('[data-task-text]')).toHaveText('follow through')
    expect(saved(userData)[0]?.text).toBe('follow through')

    await page.getByRole('button', { name: 'Next day' }).click()
    const editedRow = taskRow(page, 'follow through edited')
    await editedRow.getByRole('checkbox', { name: 'Mark task not done' }).click()
    await expect(editedRow).toHaveAttribute('data-state', 'open')
    await expect.poll(() => saved(userData)[1]?.dateCompleted).toBeNull()

    await page.getByRole('heading', { level: 1 }).click()
    await page.keyboard.press(`${modifier}+Z`)
    await expect(editedRow).toHaveAttribute('data-state', 'done')
    await expect.poll(() => saved(userData)[1]?.dateCompleted).toBe('2026-11-02')
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(editedRow).toHaveAttribute('data-state', 'open')
    await expect.poll(() => saved(userData)[1]?.dateCompleted).toBeNull()

    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(taskRow(page, 'follow through')).toHaveAttribute('data-state', 'open')
  } finally {
    await closeApp(app, userData)
  }
})

test('the calendar lights the actual completion day, not the carried origin day', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'calendar chain')
    await expect.poll(() => saved(userData).map((row) => row.text)).toEqual(['calendar chain'])
    await jumpTo(app, page, day2)
    await page.getByRole('button', { name: 'Next day' }).click()
    await taskRow(page, 'calendar chain').getByRole('checkbox', { name: 'Mark task done' }).click()
    await expect.poll(() => saved(userData).map((row) => row.dateCompleted)).toEqual([null, '2026-11-02'])

    await openCalendar(page)
    await expect(page.locator('[data-date="2026-11-02"]')).toHaveAttribute('data-active', 'true')
    await expect(page.locator('[data-date="2026-11-01"]')).toHaveAttribute('data-active', 'false')
  } finally {
    await closeApp(app, userData)
  }
})
