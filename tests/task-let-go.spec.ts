import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

const day1 = '2026-11-01T12:00:00'
const day2 = '2026-11-02T12:00:00'
const LET_GO = "Let go (won't carry over)"

interface Saved {
  text: string
  dateCreated: string
  droppedAt: string | null
}

function saved(userData: string): Saved[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db.prepare(`SELECT text, dateCreated, droppedAt FROM tasks ORDER BY dateCreated, rowid`).all() as Saved[]
  db.close()
  return rows
}

function heading(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

function taskRow(page: Page, text: string) {
  return page.locator('[data-task-text]', { hasText: new RegExp(`^${text}$`) }).locator('xpath=../..')
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

// Typing is written 200ms later, and a carry run reads the saved rows, so a jump
// before that flush copies empty text. Escape is the field's own way out: it blurs
// and clears the editing state, which tints the row and reveals its actions.
async function settle(page: Page, userData: string, ...texts: string[]): Promise<void> {
  await page.keyboard.press('Escape')
  await expect
    .poll(() => {
      const rows = saved(userData).map((row) => row.text)
      return texts.every((text) => rows.includes(text))
    })
    .toBe(true)
  await expect(taskRow(page, texts[0] ?? '')).toHaveAttribute('data-editing', 'false')
  await page.mouse.move(8, 400)
}

function opacity(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => getComputedStyle(element).getPropertyValue('opacity'))
}

function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const probe = document.createElement('span')
    probe.style.color = raw
    probe.style.position = 'absolute'
    probe.style.opacity = '0'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}

async function setSetting(page: Page, label: RegExp, want: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click()
  const item = page.getByRole('menuitemcheckbox', { name: label })
  if ((await item.getAttribute('aria-checked')) !== String(want)) await item.click()
  await expect(item).toHaveAttribute('aria-checked', String(want))
  await page.keyboard.press('Escape')
}

test('letting go is reachable by hover and keyboard, is one undo step, and stops the carry', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'let this go')
    await settle(page, userData, 'let this go')
    const row = taskRow(page, 'let this go')
    await expect(row).toHaveAttribute('data-state', 'open')
    const action = row.getByRole('button', { name: LET_GO })
    await expect(action).toHaveCount(1)
    await expect(action).toHaveAttribute('data-action', 'let-go')
    await expect(action).toHaveAttribute('title', LET_GO)

    const box = await row.boundingBox()
    if (!box) throw new Error('Row box missing')
    await page.mouse.move(8, 400)
    expect(await opacity(page, '.task-actions')).toBe('0')
    const left = box.x + 24
    for (const x of [left, left + 18, left + 36, left + 54]) {
      await page.mouse.move(x, box.y + box.height / 2)
      expect(await opacity(page, '.task-actions')).toBe('1')
    }
    const size = await action.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    expect(size.width).toBeGreaterThanOrEqual(24)
    expect(size.height).toBeGreaterThanOrEqual(24)

    await row.locator('[data-task-text]').click()
    await page.keyboard.press('Tab')
    await expect(page.locator('.task-action')).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(row).toHaveAttribute('data-state', 'dropped')
    await expect(row.locator('.task-state-mark[data-mark="dropped"]')).toHaveAttribute('title', 'Let go on Nov 1')
    expect(
      await row
        .locator('.bullet-text')
        .evaluate((element) => getComputedStyle(element).getPropertyValue('text-decoration-line')),
    ).toBe('line-through')
    expect(
      await row.locator('.bullet-text').evaluate((element) => getComputedStyle(element).getPropertyValue('color')),
    ).toBe(await tokenColor(page, '--dropped'))
    await expect.poll(() => saved(userData)[0]?.droppedAt).toBe('2026-11-01')
    await expect(row.getByRole('button', { name: 'Undo drop' })).toHaveAttribute('data-action', 'undrop')
    // The date belongs to the marker alone, so the button cannot read as a second, dated action.
    await expect(row.getByRole('button', { name: 'Undo drop' })).toHaveAttribute('title', 'Undo drop')

    await heading(page).click()
    await page.keyboard.press(`${modifier}+Z`)
    await expect(row).toHaveAttribute('data-state', 'open')
    await expect.poll(() => saved(userData)[0]?.droppedAt).toBeNull()

    await row.hover()
    await row.getByRole('button', { name: LET_GO }).click()
    await expect(row).toHaveAttribute('data-state', 'dropped')
    await row.hover()
    await row.getByRole('button', { name: 'Undo drop' }).click()
    await expect(row).toHaveAttribute('data-state', 'open')
    await expect.poll(() => saved(userData)[0]?.droppedAt).toBeNull()

    await row.hover()
    await row.getByRole('button', { name: LET_GO }).click()
    await expect(row).toHaveAttribute('data-state', 'dropped')

    await jumpTo(app, page, day2)
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(heading(page)).toHaveText('Today')
    await expect(taskRow(page, 'let this go')).toHaveCount(0)
    await expect.poll(() => saved(userData).filter((row2) => row2.dateCreated === '2026-11-02')).toEqual([])
  } finally {
    await closeApp(app, userData)
  }
})

test('carrying off stops the next day and turning it back on brings the copy forward at once', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  const userData = opened.userData
  try {
    await writeTask(page, 'stay put')
    await setSetting(page, /Carry unfinished tasks to the next day/, false)

    await jumpTo(app, page, day2)
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(heading(page)).toHaveText('Today')
    await expect(taskRow(page, 'stay put')).toHaveCount(0)
    expect(saved(userData).filter((row) => row.dateCreated === '2026-11-02')).toEqual([])

    await closeApp(app, userData, true)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day2 } })
    app = restarted.app
    page = restarted.page
    await expect(heading(page)).toHaveText('Today')
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Carry unfinished tasks/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await page.keyboard.press('Escape')
    await expect(taskRow(page, 'stay put')).toHaveCount(0)
    expect(saved(userData)).toHaveLength(1)

    await setSetting(page, /Carry unfinished tasks to the next day/, true)
    await expect(taskRow(page, 'stay put')).toHaveCount(1)
    const copy = taskRow(page, 'stay put')
    await expect(copy).toHaveAttribute('data-carried', '1')
    await expect(copy.locator('.task-state-mark[data-mark="carried"]')).toHaveAttribute(
      'title',
      'Carried from Nov 1 · day 1',
    )
    await expect.poll(() => saved(userData)).toEqual([
      { text: 'stay put', dateCreated: '2026-11-01', droppedAt: null },
      { text: 'stay put', dateCreated: '2026-11-02', droppedAt: null },
    ])
  } finally {
    await closeApp(app, userData)
  }
})
