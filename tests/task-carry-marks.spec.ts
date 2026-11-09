import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, writeTask } from './launch'

const day1 = '2026-11-01T12:00:00'
const day2 = '2026-11-02T12:00:00'
const day3 = '2026-11-03T12:00:00'
const day4 = '2026-11-04T12:00:00'
const day5 = '2026-11-05T12:00:00'

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

async function carryToToday(app: ElectronApplication, page: Page, iso: string): Promise<void> {
  await jumpTo(app, page, iso)
  await page.getByRole('button', { name: 'Next day' }).click()
  await expect(heading(page)).toHaveText('Today')
}

// Any token value, resolved the way the page paints it.
async function tokenColor(page: Page, token: string): Promise<string> {
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

function painted(page: Page, selector: string, property: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)
}

test('a finished-later copy is checked in its own color, with a double tick and a dated tooltip', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'later finish')
    await carryToToday(app, page, day2)
    const live = taskRow(page, 'later finish')
    await expect(live).toHaveAttribute('data-state', 'done')
    await live.getByRole('checkbox', { name: 'Mark task done' }).click()
    await expect(live.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    expect(await painted(page, '[data-state="done"] .task-check', 'border-top-color')).toBe(
      await tokenColor(page, '--text'),
    )
    expect(await live.locator('.task-check svg path').count()).toBe(1)

    await page.getByRole('button', { name: 'Previous day' }).click()
    const earlier = taskRow(page, 'later finish')
    await expect(earlier).toHaveAttribute('data-state', 'finished-later')
    const box = earlier.locator('.task-check')
    await expect(box).toHaveAttribute('aria-checked', 'true')
    await expect(box).toHaveAttribute('aria-readonly', 'true')
    await expect(box).toHaveAttribute('title', 'Finished Nov 2')
    const finished = await tokenColor(page, '--finished-later')
    expect(await painted(page, '[data-state="finished-later"] .task-check', 'border-top-color')).toBe(finished)
    expect(await painted(page, '[data-state="finished-later"] .task-check svg', 'color')).toBe(finished)
    await expect(box.locator('svg path')).toHaveCount(2)
    expect(await painted(page, '[data-state="finished-later"] .bullet-text', 'color')).toBe(
      await tokenColor(page, '--text-muted'),
    )
  } finally {
    await closeApp(app, userData)
  }
})

test('a carried copy shows its marker, the day count, and a tint that caps at three steps', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'carry me')
    await expect(taskRow(page, 'carry me')).toHaveAttribute('data-state', 'open')
    await expect(taskRow(page, 'carry me')).not.toHaveAttribute('data-carried')
    expect(await taskRow(page, 'carry me').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    )

    await carryToToday(app, page, day2)
    await expect(taskRow(page, 'carry me')).toHaveAttribute('data-carried', '1')
    await expect(taskRow(page, 'carry me')).toHaveAttribute('data-tint', '1')
    const mark = page.locator('.task-state-mark[data-mark="carried"]')
    await expect(mark).toHaveAttribute('aria-label', 'Carried from Nov 1 · day 1')
    await expect(mark).toHaveAttribute('title', 'Carried from Nov 1 · day 1')
    expect(await painted(page, '.task-state-mark[data-mark="carried"]', 'color')).toBe(
      await tokenColor(page, '--carried-strong'),
    )
    const clear = await taskRow(page, 'carry me').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(clear).not.toBe('rgba(0, 0, 0, 0)')

    await carryToToday(app, page, day3)
    await expect(taskRow(page, 'carry me')).toHaveAttribute('data-tint', '2')
    await expect(page.locator('.task-state-mark[data-mark="carried"]')).toHaveAttribute(
      'title',
      'Carried from Nov 2 · day 2',
    )
    const second = await taskRow(page, 'carry me').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(second).not.toBe(clear)

    await carryToToday(app, page, day4)
    await expect(taskRow(page, 'carry me')).toHaveAttribute('data-carried', '3')
    await expect(taskRow(page, 'carry me')).toHaveAttribute('data-tint', '3')
    await expect(page.locator('.task-state-mark[data-mark="carried"]')).toHaveAttribute(
      'title',
      'Carried from Nov 3 · day 3',
    )
    const third = await taskRow(page, 'carry me').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(third).not.toBe(second)

    await carryToToday(app, page, day5)
    await expect(taskRow(page, 'carry me')).toHaveAttribute('data-carried', '4')
    await expect(taskRow(page, 'carry me')).toHaveAttribute('data-tint', '3')
    await expect(page.locator('.task-state-mark[data-mark="carried"]')).toHaveAttribute(
      'title',
      'Carried from Nov 4 · day 4',
    )
    const capped = await taskRow(page, 'carry me').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(capped).toBe(third)
  } finally {
    await closeApp(app, userData)
  }
})

test('turning the highlight off drops the tint and marker color but keeps the tooltips, and stays off', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  const userData = opened.userData
  try {
    await writeTask(page, 'quiet carry')
    await carryToToday(app, page, day2)
    await expect(taskRow(page, 'quiet carry')).toHaveAttribute('data-tint', '1')

    await page.getByRole('button', { name: 'Menu' }).click()
    const item = page.getByRole('menuitemcheckbox', { name: /Highlight carried tasks/ })
    await expect(item).toHaveAttribute('aria-checked', 'true')
    await item.click()
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')

    await expect(page.locator('[data-carried-highlight="0"]')).toBeVisible()
    const row = taskRow(page, 'quiet carry')
    expect(await row.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    expect(await painted(page, '.task-state-mark[data-mark="carried"]', 'color')).toBe(
      await tokenColor(page, '--text-muted'),
    )
    await expect(row).toHaveAttribute('data-carried', '1')
    await expect(row).toHaveAttribute('data-tint', '1')
    await expect(page.locator('.task-state-mark[data-mark="carried"]')).toHaveAttribute(
      'title',
      'Carried from Nov 1 · day 1',
    )

    await closeApp(app, userData, true)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day2 } })
    app = restarted.app
    page = restarted.page
    await expect(page.locator('[data-carried-highlight="0"]')).toBeVisible()
    await expect(taskRow(page, 'quiet carry')).toHaveAttribute('data-tint', '1')
    expect(await taskRow(page, 'quiet carry').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    )
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Highlight carried tasks/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  } finally {
    await closeApp(app, userData)
  }
})

test('branch nodes carry the same marks as the main list', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  const { app, page, userData } = opened
  try {
    await writeTask(page, 'branch parent')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('branch child')
    await expect(taskRow(page, 'branch child')).toHaveCount(1)
    await carryToToday(app, page, day2)
    await expect(taskRow(page, 'branch child')).toHaveCount(1)
    const branch = page.locator('.react-flow__node-branch').filter({ hasText: 'branch child' })
    await expect(branch.locator('[data-carried="1"]')).toHaveCount(1)
    await expect(branch.locator('.task-state-mark[data-mark="carried"]')).toHaveCount(1)
    await expect(branch.locator('.task-state-mark[data-mark="carried"]')).toHaveAttribute(
      'title',
      'Carried from Nov 1 · day 1',
    )
    expect(await branch.locator('.task-actions').evaluate((element) => getComputedStyle(element).opacity)).toBe('0')
    await branch.hover()
    expect(await branch.locator('.task-actions').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  } finally {
    await closeApp(app, userData)
  }
})
