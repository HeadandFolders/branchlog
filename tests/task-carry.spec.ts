import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { addDays } from '../src/shared/dates.ts'
import { closeApp, launchApp, modifier, writeTask } from './launch'

const day1 = '2026-11-01T12:00:00'
const day2 = '2026-11-02T12:00:00'
const day4 = '2026-11-04T12:00:00'

interface Saved {
  text: string
  dateCreated: string
  carriedFromId: string | null
}

function saved(userData: string): Saved[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db
    .prepare(
      `SELECT text, dateCreated, carriedFromId
       FROM tasks
       ORDER BY dateCreated, side, orderIndex`,
    )
    .all() as Saved[]
  db.close()
  return rows
}

function heading(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

async function writeLines(page: Page, first: string, second: string): Promise<void> {
  await writeTask(page, first)
  await page.keyboard.press('Enter')
  await page.keyboard.type(second)
  await expect(page.locator('[data-task-text]', { hasText: second })).toBeVisible()
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

test('unfinished tasks appear on the next day and remain on the first day', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeLines(page, 'Milk', 'Bread')
    await expect.poll(() => saved(userData).map((row) => row.text)).toEqual(['Milk', 'Bread'])
    await jumpTo(app, page, day2)
    await expect(heading(page)).not.toHaveText('Today')
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(heading(page)).toHaveText('Today')
    await expect(page.locator('[data-task-text]')).toHaveText(['Milk', 'Bread'])
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.locator('[data-task-text]')).toHaveText(['Milk', 'Bread'])
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(heading(page)).toHaveText('Today')
    await heading(page).click()
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect.poll(() => saved(userData).map((row) => row.dateCreated)).toEqual(['2026-11-01', '2026-11-01'])
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.locator('[data-task-text]')).toHaveText(['Milk', 'Bread'])
  } finally {
    await closeApp(app, userData)
  }
})

test('midnight carries the open day forward without a restart', async () => {
  test.setTimeout(90_000)
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: 'before-midnight:20' } })
  const { app, page, userData } = opened
  try {
    await expect.poll(() => page.evaluate(() => window.location.search)).toContain('before-midnight')
    await writeTask(page, 'Overnight')
    await expect.poll(() => saved(userData).map((row) => row.text)).toEqual(['Overnight'])
    const openedDay = await page.getByRole('textbox', { name: 'Choose a date' }).inputValue()
    await expect(heading(page)).not.toHaveText('Today', { timeout: 45_000 })
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(heading(page)).toHaveText('Today')
    await expect(page.locator('[data-task-text]')).toHaveText('Overnight')
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.locator('[data-task-text]')).toHaveText('Overnight')
    const nextDay = addDays(openedDay, 1)
    await expect.poll(() => saved(userData).map((row) => row.dateCreated)).toEqual([openedDay, nextDay])
    const links = saved(userData)
    expect(links[1]?.carriedFromId).toBeTruthy()
    expect(links[0]?.carriedFromId).toBeNull()
  } finally {
    await closeApp(app, userData)
  }
})

test('a restart on a later date carries once', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  const userData = opened.userData
  try {
    await writeLines(opened.page, 'Milk', 'Bread')
    await expect.poll(() => saved(userData).map((row) => row.text)).toEqual(['Milk', 'Bread'])
    await closeApp(app, userData, true)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4 } })
    app = restarted.app
    await expect(restarted.page.locator('[data-task-text]')).toHaveText(['Milk', 'Bread'])
    await expect.poll(() => saved(userData).map((row) => row.dateCreated)).toEqual([
      '2026-11-01',
      '2026-11-01',
      '2026-11-04',
      '2026-11-04',
    ])
    await closeApp(app, userData, true)
    const again = await launchApp(userData, { env: { BRANCHLOG_NOW: day4 } })
    app = again.app
    await expect(again.page.locator('[data-task-text]')).toHaveText(['Milk', 'Bread'])
    expect(saved(userData).map((row) => row.dateCreated)).toEqual([
      '2026-11-01',
      '2026-11-01',
      '2026-11-04',
      '2026-11-04',
    ])
  } finally {
    await closeApp(app, userData)
  }
})
