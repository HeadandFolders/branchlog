import path from 'node:path'
import Database from 'better-sqlite3'
import { format } from 'date-fns'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { addDays, localDateKey, parseDateKey } from '../src/shared/dates'
import { closeApp, launchApp, writeTask } from './launch'

function titleFor(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return 'Today'
  const date = parseDateKey(dateKey)
  const pattern =
    date.getFullYear() === parseDateKey(todayKey).getFullYear() ? 'EEEE, MMMM d' : 'EEEE, MMMM d, yyyy'
  return format(date, pattern)
}

function heading(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

function dateField(page: Page) {
  return page.getByRole('textbox', { name: 'Choose a date' })
}

test.describe('the today label', () => {
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

  test('the open day says Today only when it is the current date', async () => {
    const today = localDateKey()
    await expect(dateField(page)).toHaveValue(today)
    await expect(heading(page)).toHaveText('Today')
  })

  test('yesterday and tomorrow show their dates', async () => {
    const today = localDateKey()
    const yesterday = addDays(today, -1)
    const tomorrow = addDays(today, 1)
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(dateField(page)).toHaveValue(yesterday)
    await expect(heading(page)).toHaveText(titleFor(yesterday, today))
    await expect(page.getByText('Today', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Next day' }).click()
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(dateField(page)).toHaveValue(tomorrow)
    await expect(heading(page)).toHaveText(titleFor(tomorrow, today))
    await expect(page.getByText('Today', { exact: true })).toHaveCount(0)
  })

  test('moving across days keeps the label, and Today returns to the current date', async () => {
    const today = localDateKey()
    let cursor = today
    await expect(heading(page)).toHaveText('Today')
    for (let step = 0; step < 3; step += 1) {
      await page.getByRole('button', { name: 'Previous day' }).click()
      cursor = addDays(cursor, -1)
      await expect(dateField(page)).toHaveValue(cursor)
      await expect(heading(page)).toHaveText(titleFor(cursor, today))
      await expect(page.getByText('Today', { exact: true })).toHaveCount(0)
    }
    for (let step = 0; step < 3; step += 1) {
      await page.getByRole('button', { name: 'Next day' }).click()
      cursor = addDays(cursor, 1)
      await expect(dateField(page)).toHaveValue(cursor)
      await expect(heading(page)).toHaveText(cursor === today ? 'Today' : titleFor(cursor, today))
    }
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(heading(page)).not.toHaveText('Today')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Go to Today' }).click()
    await expect(dateField(page)).toHaveValue(today)
    await expect(heading(page)).toHaveText('Today')
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(heading(page)).toHaveText(titleFor(addDays(today, -1), today))
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Go to Today' }).click()
    await expect(dateField(page)).toHaveValue(today)
    await expect(heading(page)).toHaveText('Today')
  })

  test('the date picker shows Today only for the current date', async () => {
    const today = localDateKey()
    const picker = dateField(page)
    await picker.fill('2020-05-03')
    await expect(picker).toHaveValue('2020-05-03')
    await expect(heading(page)).toHaveText('Sunday, May 3, 2020')
    await expect(page.getByText('Today', { exact: true })).toHaveCount(0)
    await picker.fill(today)
    await expect(heading(page)).toHaveText('Today')
  })
})

test('midnight rolls the today label without a restart', async () => {
  test.setTimeout(90_000)
  const launched = await launchApp('', { env: { BRANCHLOG_NOW: 'before-midnight:20' } })
  try {
    const title = heading(launched.page)
    const picker = dateField(launched.page)
    await expect(title).toHaveText('Today')
    const opened = await picker.inputValue()
    await expect(title).toHaveText(titleFor(opened, addDays(opened, 1)), { timeout: 40_000 })
    await expect(launched.page.getByText('Today', { exact: true })).toHaveCount(0)
    await launched.page.getByRole('button', { name: 'Next day' }).click()
    await expect(picker).toHaveValue(addDays(opened, 1))
    await expect(title).toHaveText('Today')
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('previous and next cross a daylight saving change on the calendar', async () => {
  const launched = await launchApp('', { timezoneId: 'America/New_York' })
  const page = launched.page
  try {
    const picker = dateField(page)
    await picker.fill('2026-11-01')
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(picker).toHaveValue('2026-11-02')
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(picker).toHaveValue('2026-11-01')
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(picker).toHaveValue('2026-10-31')
    await picker.fill('2026-03-08')
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(picker).toHaveValue('2026-03-07')
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(picker).toHaveValue('2026-03-08')
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(picker).toHaveValue('2026-03-09')
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test.describe('today follows the local date, not UTC', () => {
  const zones = [
    {
      id: 'Pacific/Auckland',
      instant: '2026-11-08T12:00:00.000Z',
      localKey: '2026-11-09',
      utcKey: '2026-11-08',
    },
    {
      id: 'Pacific/Honolulu',
      instant: '2026-11-08T06:00:00.000Z',
      localKey: '2026-11-07',
      utcKey: '2026-11-08',
    },
  ]

  for (const zone of zones) {
    test(`${zone.id} uses the local day for the label and dateCreated`, async () => {
      const launched = await launchApp('', {
        timezoneId: zone.id,
        env: { BRANCHLOG_NOW: zone.instant, TZ: zone.id },
      })
      try {
        await expect(dateField(launched.page)).toHaveValue(zone.localKey)
        await expect(heading(launched.page)).toHaveText('Today')
        expect(zone.localKey).not.toBe(zone.utcKey)
        await writeTask(launched.page, 'zoned task')
        await expect.poll(() => {
          const db = new Database(path.join(launched.userData, 'branchlog.sqlite'))
          db.pragma('busy_timeout = 3000')
          const row = db.prepare('SELECT dateCreated, text FROM tasks').all() as { dateCreated: string; text: string }[]
          db.close()
          return row
        }).toEqual([{ dateCreated: zone.localKey, text: 'zoned task' }])
      } finally {
        await closeApp(launched.app, launched.userData)
      }
    })
  }
})

test('a later fake date is Today and earlier tasks stay on their day', async () => {
  const first = new Date(2026, 0, 15, 12, 0, 0).toISOString()
  const later = new Date(2026, 0, 18, 12, 0, 0).toISOString()
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: first } })
  let app = opened.app
  const userData = opened.userData
  try {
    await expect(dateField(opened.page)).toHaveValue('2026-01-15')
    await expect(heading(opened.page)).toHaveText('Today')
    await writeTask(opened.page, 'stays on january')
    await closeApp(app, userData, true)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: later } })
    app = restarted.app
    await expect(dateField(restarted.page)).toHaveValue('2026-01-18')
    await expect(heading(restarted.page)).toHaveText('Today')
    await expect(restarted.page.locator('[data-task-text]')).toHaveCount(0)
    await dateField(restarted.page).fill('2026-01-15')
    await expect(heading(restarted.page)).toHaveText(titleFor('2026-01-15', '2026-01-18'))
    await expect(restarted.page.locator('[data-task-text]')).toHaveText('stays on january')
    const db = new Database(path.join(userData, 'branchlog.sqlite'))
    db.pragma('busy_timeout = 3000')
    const row = db.prepare('SELECT dateCreated FROM tasks WHERE text = ?').get('stays on january') as
      | { dateCreated: string }
      | undefined
    db.close()
    expect(row?.dateCreated).toBe('2026-01-15')
  } finally {
    await closeApp(app, userData)
  }
})
