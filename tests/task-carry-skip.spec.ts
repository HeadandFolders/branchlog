import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

const day1 = '2026-11-01T12:00:00'
const day2 = '2026-11-02T12:00:00'
const day3 = '2026-11-03T12:00:00'
const day4 = '2026-11-04T12:00:00'

const CARRIED_NOTICE = 'Removed for today. It will carry over again tomorrow. Undo'

interface Saved {
  id: string
  text: string
  dateCreated: string
  parentId: string | null
  carriedFromId: string | null
  chainId: string
  droppedAt: string | null
  dateCompleted: string | null
}

function openDb(userData: string): Database.Database {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  return db
}

function saved(userData: string): Saved[] {
  const db = openDb(userData)
  const rows = db
    .prepare(
      `SELECT id, text, dateCreated, parentId, carriedFromId, chainId, droppedAt, dateCompleted
       FROM tasks ORDER BY dateCreated, side, orderIndex, rowid`,
    )
    .all() as Saved[]
  db.close()
  return rows
}

function onDay(userData: string, date: string): Saved[] {
  return saved(userData).filter((row) => row.dateCreated === date)
}

function skipRows(userData: string): { chainId: string; dateKey: string }[] {
  const db = openDb(userData)
  const rows = db.prepare('SELECT chainId, dateKey FROM carrySkips ORDER BY dateKey').all() as {
    chainId: string
    dateKey: string
  }[]
  db.close()
  return rows
}

function savedTexts(userData: string): string[] {
  return saved(userData).map((row) => row.text)
}

function heading(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

function taskRow(page: Page, text: string) {
  return page.locator('[data-task-text]', { hasText: new RegExp(`^${text}$`) }).locator('xpath=../..')
}

function mainTexts(page: Page) {
  return page.locator('.task-list [data-task-text]')
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

// The other engine trigger: the window losing and regaining focus.
async function refocus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('browser-window-focus')
  })
}

async function carryToToday(app: ElectronApplication, page: Page, iso: string): Promise<void> {
  await jumpTo(app, page, iso)
  // A clock jump re-reads today but leaves the viewed day where it was, so walk forward to it.
  for (let step = 0; step < 6; step += 1) {
    if ((await heading(page).textContent()) === 'Today') break
    await page.getByRole('button', { name: 'Next day' }).click()
  }
  await expect(heading(page)).toHaveText('Today')
}

async function settle(page: Page, userData: string, ...texts: string[]): Promise<void> {
  await page.keyboard.press('Escape')
  await expect.poll(() => texts.every((text) => savedTexts(userData).includes(text))).toBe(true)
  await expect(taskRow(page, texts[0] ?? '')).toHaveAttribute('data-editing', 'false')
  await page.mouse.move(8, 400)
}

async function deleteTask(page: Page, text: string): Promise<string> {
  const row = page.locator('[data-task-text]', { hasText: new RegExp(`^${text}$`) }).first()
  const id = await row.getAttribute('data-task-id')
  if (!id) throw new Error(`no id for ${text}`)
  const task = page.locator(`[data-task-text][data-task-id="${id}"]`)
  await task.click()
  await page.keyboard.press(`${modifier}+A`)
  await page.keyboard.press('Backspace')
  await expect(task).toHaveText('')
  await page.keyboard.press('Backspace')
  return id
}

function rowById(page: Page, id: string) {
  return page.locator(`[data-task-text][data-task-id="${id}"]`)
}

test('a deleted carried copy stays gone that day and comes back the next day from the copy that still exists', async () => {
  test.setTimeout(200_000)
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  const userData = opened.userData
  try {
    await writeTask(page, 'water the plants')
    await page.keyboard.press('Enter')
    await page.keyboard.type('file the report')
    await settle(page, userData, 'water the plants', 'file the report')

    await carryToToday(app, page, day2)
    await expect(mainTexts(page)).toHaveText(['water the plants', 'file the report'])
    const day2Water = onDay(userData, '2026-11-02').find((row) => row.text === 'water the plants')
    if (!day2Water) throw new Error('no day 2 copy')
    const day1Rows = onDay(userData, '2026-11-01')

    await carryToToday(app, page, day3)
    await expect(mainTexts(page)).toHaveText(['water the plants', 'file the report'])

    await deleteTask(page, 'water the plants')
    await expect(page.getByRole('status')).toHaveText(CARRIED_NOTICE)
    await expect(mainTexts(page)).toHaveText(['file the report'])
    expect(onDay(userData, '2026-11-03').map((row) => row.text)).toEqual(['file the report'])
    expect(onDay(userData, '2026-11-01')).toEqual(day1Rows)
    expect(skipRows(userData)).toHaveLength(1)
    expect(skipRows(userData)[0]?.dateKey).toBe('2026-11-03')
    expect(skipRows(userData)[0]?.chainId).toBe(day1Rows[0]?.id)

    await refocus(app)
    await jumpTo(app, page, day3)
    await expect.poll(() => onDay(userData, '2026-11-03')).toHaveLength(1)
    await expect(mainTexts(page)).toHaveText(['file the report'])

    // The earlier copies are still open, not let go.
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(taskRow(page, 'water the plants')).toHaveAttribute('data-state', 'open')
    await expect(page.locator('[data-state="dropped"]')).toHaveCount(0)
    await expect(page.locator('.task-state-mark[data-mark="dropped"]')).toHaveCount(0)

    // Tomorrow carries from the newest copy that still exists, exactly once.
    await carryToToday(app, page, day4)
    const day4Rows = onDay(userData, '2026-11-04')
    expect(day4Rows.map((row) => row.text)).toEqual(['water the plants', 'file the report'])
    expect(day4Rows.filter((row) => row.text === 'water the plants')).toHaveLength(1)
    expect(day4Rows.find((row) => row.text === 'water the plants')?.carriedFromId).toBe(day2Water.id)
    expect(onDay(userData, '2026-11-03').map((row) => row.text)).toEqual(['file the report'])

    await closeApp(app, userData, true)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day3 } })
    app = restarted.app
    page = restarted.page
    await expect(mainTexts(page)).toHaveText(['file the report'])
    expect(onDay(userData, '2026-11-03')).toHaveLength(1)
    expect(skipRows(userData)).toHaveLength(1)
  } finally {
    await closeApp(app, userData)
  }
})

test('undo brings the copy back with no duplicate and redo deletes it again', async () => {
  test.setTimeout(120_000)
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'defer again')
    await settle(page, userData, 'defer again')
    await carryToToday(app, page, day2)
    const copy = onDay(userData, '2026-11-02')[0]
    if (!copy) throw new Error('no copy')

    await deleteTask(page, 'defer again')
    await expect(page.getByRole('status')).toHaveText(CARRIED_NOTICE)
    await refocus(app)
    expect(onDay(userData, '2026-11-02')).toEqual([])
    expect(skipRows(userData)).toHaveLength(1)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(rowById(page, copy.id)).toBeVisible()
    expect(onDay(userData, '2026-11-02').map((row) => row.id)).toEqual([copy.id])
    expect(skipRows(userData)).toEqual([])

    // The keyboard path empties the field before deleting it, so one more undo takes
    // the text back. The row itself came back with its own id and chain.
    await heading(page).click()
    await page.keyboard.press(`${modifier}+Z`)
    await expect(rowById(page, copy.id)).toHaveText('defer again')
    expect(onDay(userData, '2026-11-02').map((row) => row.text)).toEqual(['defer again'])

    await refocus(app)
    expect(onDay(userData, '2026-11-02')).toHaveLength(1)

    // Redoing both steps deletes the copy again and records the skip again.
    await heading(page).click()
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(page.getByRole('status')).toHaveText(CARRIED_NOTICE)
    await expect(mainTexts(page)).toHaveCount(0)
    expect(onDay(userData, '2026-11-02')).toEqual([])
    expect(skipRows(userData)).toHaveLength(1)
    await refocus(app)
    expect(onDay(userData, '2026-11-02')).toEqual([])
  } finally {
    await closeApp(app, userData)
  }
})

test('an ordinary delete keeps its own message and stays gone after ten seconds, a day switch and a restart', async () => {
  test.setTimeout(200_000)
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  const userData = opened.userData
  try {
    await writeTask(page, 'Keep')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Drop me')
    await settle(page, userData, 'Keep', 'Drop me')
    await page.getByRole('button', { name: 'Branch from this task' }).first().click()
    await page.keyboard.type('Branch of Keep')
    await settle(page, userData, 'Branch of Keep')

    await deleteTask(page, 'Drop me')
    await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')

    await page.waitForTimeout(10_000)
    expect(savedTexts(userData)).toEqual(['Keep', 'Branch of Keep'])

    await page.getByRole('button', { name: 'Previous day' }).click()
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(mainTexts(page)).toHaveText(['Keep'])
    await expect(page.locator('.react-flow__node-branch [data-task-text]')).toHaveText(['Branch of Keep'])

    await closeApp(app, userData, true)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day1 } })
    app = restarted.app
    page = restarted.page
    await expect(mainTexts(page)).toHaveText(['Keep'])
    expect(savedTexts(userData)).toEqual(['Keep', 'Branch of Keep'])
    expect(skipRows(userData)).toEqual([])
  } finally {
    await closeApp(app, userData)
  }
})

test('deleting inside the pending text save window leaves no row behind', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'ghost')
    const id = await page.locator('[data-task-text]').first().getAttribute('data-task-id')
    if (!id) throw new Error('no id')
    await page.keyboard.type(' text still queued')
    await deleteTask(page, 'ghost text still queued')
    expect(saved(userData)).toHaveLength(0)

    await page.waitForTimeout(1_000)
    expect(saved(userData)).toEqual([])
    expect(saved(userData).filter((row) => row.id === id)).toEqual([])
    await expect(mainTexts(page)).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
  }
})

function savedIds(userData: string): string[] {
  return saved(userData).map((row) => row.id)
}

async function blur(page: Page): Promise<void> {
  await heading(page).click()
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
}

test('the delete notice undoes only when it is asked to', async () => {
  test.setTimeout(120_000)
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'alpha')
    await page.keyboard.press('Enter')
    await page.keyboard.type('beta')
    await page.keyboard.press('Enter')
    await page.keyboard.type('gamma')
    await settle(page, userData, 'alpha', 'beta', 'gamma')

    // A notice left to its timer only dismisses itself.
    const alphaId = await deleteTask(page, 'alpha')
    await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')
    await page.waitForTimeout(9_000)
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(rowById(page, alphaId)).toHaveCount(0)
    expect(savedIds(userData)).not.toContain(alphaId)
    await expect(mainTexts(page)).toHaveCount(2)

    const betaId = await deleteTask(page, 'beta')
    await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(rowById(page, betaId)).toBeVisible()
    expect(savedIds(userData)).toContain(betaId)
    // Alpha is gone for good, so the day is back to two rows rather than three.
    await expect(mainTexts(page)).toHaveCount(2)

    const gammaId = await deleteTask(page, 'gamma')
    await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')
    await blur(page)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(rowById(page, gammaId)).toBeVisible()
    expect(savedIds(userData)).toContain(gammaId)
  } finally {
    await closeApp(app, userData)
  }
})

test('no key other than the undo and redo shortcuts brings a deleted task back', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'Keep')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Remove me')
    await settle(page, userData, 'Keep', 'Remove me')

    const removedId = await deleteTask(page, 'Remove me')
    await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')

    await blur(page)
    for (const key of ['Backspace', 'Delete', 'Escape', 'Tab']) {
      await page.keyboard.press(key)
      await expect(rowById(page, removedId)).toHaveCount(0)
      await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')
    }
    expect(savedIds(userData)).not.toContain(removedId)

    await blur(page)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(rowById(page, removedId)).toBeVisible()
    expect(savedIds(userData)).toContain(removedId)

    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(rowById(page, removedId)).toHaveCount(0)
    expect(savedIds(userData)).not.toContain(removedId)
  } finally {
    await closeApp(app, userData)
  }
})

test('Alt+Enter and Ctrl+N are their own steps and never replay a delete', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'Keep')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Remove me')
    await settle(page, userData, 'Keep', 'Remove me')

    const removedId = await deleteTask(page, 'Remove me')
    await expect(page.getByRole('status')).toHaveText('Deleted 1 task. Undo')

    await blur(page)
    await page.keyboard.press('Alt+Enter')
    await expect(rowById(page, removedId)).toHaveCount(0)
    expect(savedIds(userData)).not.toContain(removedId)

    await blur(page)
    await page.keyboard.press(`${modifier}+N`)
    await expect(rowById(page, removedId)).toHaveCount(0)
    expect(savedIds(userData)).not.toContain(removedId)
  } finally {
    await closeApp(app, userData)
  }
})

test('a finished-later mark is untouched by deleting another chain copy', async () => {
  test.setTimeout(120_000)
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'finish later')
    await page.keyboard.press('Enter')
    await page.keyboard.type('delete this one')
    await settle(page, userData, 'finish later', 'delete this one')
    await carryToToday(app, page, day2)

    await taskRow(page, 'finish later').getByRole('checkbox', { name: 'Mark task done' }).click()
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(taskRow(page, 'finish later')).toHaveAttribute('data-state', 'finished-later')

    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(mainTexts(page)).toHaveText(['finish later', 'delete this one'])
    await deleteTask(page, 'delete this one')
    await expect(page.getByRole('status')).toHaveText(CARRIED_NOTICE)
    await expect(taskRow(page, 'finish later')).toHaveAttribute('data-state', 'done')
    expect(onDay(userData, '2026-11-02').map((row) => row.text)).toEqual(['finish later'])

    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(taskRow(page, 'finish later')).toHaveAttribute('data-state', 'finished-later')
  } finally {
    await closeApp(app, userData)
  }
})
