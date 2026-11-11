import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'
import {
  activeTaskId,
  cancelRevealWithGesture,
  emptyCanvasPoint,
  mainIds,
  overflow,
  readMotionTrack,
  revealArea,
  revealBusy,
  rowBox,
  seedMainList,
  settleReveal,
  startMotionTrack,
  viewport,
} from './reveal-helpers'

const LONG_TEXT = 'oat milk, coffee beans, dish soap, laundry pods, bread flour, olive oil, lemons, tea bags'

test.describe('the canvas reveals the task you are typing', () => {
  let app: ElectronApplication
  let page: Page
  let userData = ''

  async function openWithRows(count: number): Promise<string[]> {
    userData = mkdtempSync(path.join(tmpdir(), 'branchlog-reveal-'))
    const ids = seedMainList(userData, count)
    const launched = await launchApp(userData)
    app = launched.app
    page = launched.page
    return ids
  }

  test.afterEach(async () => {
    if (app) await closeApp(app, userData)
  })

  test('a new task below the screen is panned into view at the same zoom', async () => {
    await openWithRows(40)
    await page.keyboard.press('Escape')
    const before = await viewport(page)
    await startMotionTrack(page)

    await page.keyboard.press(`${modifier}+N`)
    const created = (await mainIds(page)).at(-1)
    if (!created) throw new Error('New task is missing')
    await expect.poll(() => activeTaskId(page)).toBe(created)
    await settleReveal(page)

    const stops = await readMotionTrack(page)
    const after = await viewport(page)
    const box = await rowBox(page, created)
    const area = await revealArea(page)
    expect(overflow(box, area)).toBeLessThanOrEqual(1)
    expect(before.y - after.y).toBeGreaterThan(200)
    expect(after.x).toBeCloseTo(before.x, 1)
    expect(after.zoom).toBeCloseTo(before.zoom, 3)
    // Smooth, not a jump: the paper is applied over many frames and lands on the target.
    expect(stops.length).toBeGreaterThan(4)
    expect(stops.at(-1)?.y).toBeCloseTo(after.y, 1)
    expect((stops.at(-1)?.at ?? 0) - (stops[0]?.at ?? 0)).toBeGreaterThan(150)
  })

  test('a new task that is already visible leaves the canvas exactly where it was', async () => {
    await openWithRows(20)
    const before = await mainIds(page)
    const parent = before[9]
    if (!parent) throw new Error('Middle row is missing')
    await page.locator(`.task-list [data-task-text][data-task-id="${parent}"]`).click()
    const framed = await viewport(page)
    const area = await revealArea(page)
    expect(overflow(await rowBox(page, parent), area)).toBe(0)

    await page.keyboard.press(`${modifier}+N`)
    const created = (await mainIds(page)).find((id) => !before.includes(id))
    if (!created) throw new Error('New task is missing')
    await expect.poll(() => activeTaskId(page)).toBe(created)
    await settleReveal(page)

    expect(await viewport(page)).toEqual(framed)
    expect(overflow(await rowBox(page, created), await revealArea(page))).toBe(0)
  })

  test('every character typed during the pan lands in the new task', async () => {
    await openWithRows(40)
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${modifier}+N`)
    const created = (await mainIds(page)).at(-1)
    if (!created) throw new Error('New task is missing')
    await startMotionTrack(page)

    await page.keyboard.type('buy oat milk', { delay: 25 })
    const stops = await readMotionTrack(page)
    await settleReveal(page)
    expect(stops.length).toBeGreaterThan(3)

    const row = page.locator(`.task-list [data-task-text][data-task-id="${created}"]`)
    await expect(row).toHaveText('buy oat milk')
    expect(await activeTaskId(page)).toBe(created)
    expect(overflow(await rowBox(page, created), await revealArea(page))).toBeLessThanOrEqual(1)
  })

  test('a manual wheel during the pan cancels the reveal', async () => {
    await openWithRows(40)
    await page.keyboard.press('Escape')
    const point = await emptyCanvasPoint(page)

    await page.keyboard.press(`${modifier}+N`)
    const flight = await cancelRevealWithGesture(page, point, 'wheel')
    expect(flight.busyBefore).toBe(true)
    expect(flight.busyAfter).toBe(false)

    const created = (await mainIds(page)).at(-1)
    if (!created) throw new Error('New task is missing')
    expect(flight.parked).toEqual(flight.panned)
    await page.waitForTimeout(300)
    expect(await viewport(page)).toEqual(flight.parked)
    expect(await revealBusy(page)).toBe(false)
    expect(overflow(await rowBox(page, created), await revealArea(page))).toBeGreaterThan(0)
  })

  test('grabbing the paper during the pan also cancels the reveal', async () => {
    await openWithRows(40)
    await page.keyboard.press('Escape')
    const point = await emptyCanvasPoint(page)

    await page.keyboard.press(`${modifier}+N`)
    const flight = await cancelRevealWithGesture(page, point, 'drag')
    expect(flight.busyBefore).toBe(true)
    expect(flight.busyAfter).toBe(false)

    const created = (await mainIds(page)).at(-1)
    if (!created) throw new Error('New task is missing')
    expect(flight.parked).toEqual(flight.panned)
    expect(overflow(await rowBox(page, created), await revealArea(page))).toBeGreaterThan(0)
  })

  test('typing into a visible task never moves the canvas', async () => {
    const launched = await launchApp()
    app = launched.app
    page = launched.page
    userData = launched.userData
    await writeTask(page, 'shopping')
    await page.keyboard.press('End')
    await startMotionTrack(page)
    await page.keyboard.type(LONG_TEXT, { delay: 12 })
    await page.waitForTimeout(400)

    expect(await readMotionTrack(page)).toHaveLength(1)
    await expect(page.locator('.task-list [data-task-text]').first()).toHaveText(`shopping${LONG_TEXT}`)
  })

  test('arrow keys reveal the task the caret moves to', async () => {
    await openWithRows(30)
    const ids = await mainIds(page)
    await page.locator(`.task-list [data-task-text][data-task-id="${ids[0]}"]`).click()
    const before = await viewport(page)
    await startMotionTrack(page)
    for (const id of ids.slice(1, 22)) {
      await page.keyboard.press('ArrowDown')
      await expect.poll(() => activeTaskId(page)).toBe(id)
    }
    await settleReveal(page)

    const after = await viewport(page)
    expect(before.y - after.y).toBeGreaterThan(200)
    expect(after.zoom).toBeCloseTo(before.zoom, 3)
    expect(overflow(await rowBox(page, ids[21] ?? ''), await revealArea(page))).toBeLessThanOrEqual(1)
  })

  test('one press adds one task and no extra window', async () => {
    await openWithRows(6)
    await page.keyboard.press('Escape')
    const before = await mainIds(page)

    for (let press = 0; press < 4; press += 1) {
      await page.keyboard.press(`${modifier}+N`)
      await settleReveal(page)
    }

    const after = await mainIds(page)
    expect(after).toHaveLength(before.length + 4)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  })

  test('undoing a reveal does not pan again', async () => {
    await openWithRows(40)
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${modifier}+N`)
    await settleReveal(page)
    const parked = await viewport(page)
    await startMotionTrack(page)

    await page.keyboard.press(`${modifier}+Z`)
    await settleReveal(page)

    expect(await readMotionTrack(page)).toHaveLength(1)
    expect(await viewport(page)).toEqual(parked)
    expect(await mainIds(page)).toHaveLength(40)
  })

  test('reduced motion puts the new task in place without animating', async () => {
    await openWithRows(40)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.keyboard.press('Escape')
    const before = await viewport(page)
    await startMotionTrack(page)

    await page.keyboard.press(`${modifier}+N`)
    const created = (await mainIds(page)).at(-1)
    if (!created) throw new Error('New task is missing')
    await settleReveal(page)

    const stops = await readMotionTrack(page)
    expect(stops).toHaveLength(2)
    expect(before.y - (stops[1]?.y ?? 0)).toBeGreaterThan(200)
    expect((stops[1]?.at ?? 0) - (stops[0]?.at ?? 0)).toBeLessThan(150)
    expect(overflow(await rowBox(page, created), await revealArea(page))).toBeLessThanOrEqual(1)
  })

  test('a restart frames the day again and nothing moves on its own', async () => {
    await openWithRows(40)
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${modifier}+N`)
    await settleReveal(page)
    await closeApp(app, userData, true)

    const restarted = await launchApp(userData)
    app = restarted.app
    page = restarted.page
    await page.waitForTimeout(500)
    const framed = await viewport(page)
    expect(framed.zoom).toBeCloseTo(1, 3)
    expect(Math.abs(framed.y - 28)).toBeLessThan(2)

    await startMotionTrack(page)
    await page.waitForTimeout(400)
    expect(await readMotionTrack(page)).toHaveLength(1)
    expect(await mainIds(page)).toHaveLength(41)
  })
})
