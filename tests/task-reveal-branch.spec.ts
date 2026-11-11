import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, writeTask } from './launch'
import {
  activeTaskId,
  branchIds,
  branchPosition,
  clickBranch,
  overflow,
  panPaper,
  revealArea,
  rowBox,
  settleReveal,
  viewport,
} from './reveal-helpers'

const branchKey = 'Alt+Enter'

test.describe('the canvas reveals a new branch', () => {
  let app: ElectronApplication
  let page: Page
  let userData = ''

  // A branch sits to the right of its row, so pushing the paper right puts the spot
  // where the next branch appears beyond the reveal area.
  async function branchOffTheRightEdge(): Promise<string> {
    const origin = await writeTask(page, 'origin')
    const originId = await origin.getAttribute('data-task-id')
    if (!originId) throw new Error('Origin id is missing')
    await panPaper(page, 220, 0)
    return originId
  }

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    page = launched.page
    userData = launched.userData
  })

  test.afterEach(async () => {
    await closeApp(app, userData)
  })

  test('alt enter reveals a branch that starts beyond the right edge', async () => {
    const originId = await branchOffTheRightEdge()
    await page.locator(`.task-list [data-task-text][data-task-id="${originId}"]`).click()
    const before = await viewport(page)

    await page.keyboard.press(branchKey)
    const created = (await branchIds(page)).at(-1)
    if (!created) throw new Error('Branch is missing')
    await expect.poll(() => activeTaskId(page)).toBe(created)
    await settleReveal(page)

    const after = await viewport(page)
    expect(before.x - after.x).toBeGreaterThan(40)
    expect(after.zoom).toBeCloseTo(before.zoom, 3)
    expect(after.y).toBeCloseTo(before.y, 1)
    expect(overflow(await rowBox(page, created), await revealArea(page))).toBeLessThanOrEqual(1)
  })

  test('the branch dot reveals a branch that starts beyond the right edge', async () => {
    await branchOffTheRightEdge()
    const before = await viewport(page)

    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const created = (await branchIds(page)).at(-1)
    if (!created) throw new Error('Branch is missing')
    await expect.poll(() => activeTaskId(page)).toBe(created)
    await settleReveal(page)

    const after = await viewport(page)
    expect(before.x - after.x).toBeGreaterThan(40)
    expect(overflow(await rowBox(page, created), await revealArea(page))).toBeLessThanOrEqual(1)
  })

  test('enter in a branch reveals the new sibling', async () => {
    const originId = await branchOffTheRightEdge()
    await page.locator(`.task-list [data-task-text][data-task-id="${originId}"]`).click()
    await page.keyboard.press(branchKey)
    await page.keyboard.type('first')
    await settleReveal(page)

    // Push the paper out again so the sibling lands beyond the right edge too.
    await panPaper(page, 260, 0)
    const parent = (await branchIds(page)).at(-1)
    if (!parent) throw new Error('First branch is missing')
    await clickBranch(page, parent)
    await page.keyboard.press('End')
    const before = await viewport(page)

    await page.keyboard.press('Enter')
    await page.keyboard.type('second')
    const created = (await branchIds(page)).at(-1)
    if (!created) throw new Error('Sibling branch is missing')
    expect(created).not.toBe(parent)
    await expect.poll(() => activeTaskId(page)).toBe(created)
    await settleReveal(page)

    const after = await viewport(page)
    expect(before.x - after.x).toBeGreaterThan(40)
    expect(overflow(await rowBox(page, created), await revealArea(page))).toBeLessThanOrEqual(1)
  })

  test('the reveal follows the position collision avoidance settled the node at', async () => {
    const originId = await branchOffTheRightEdge()
    await page.locator(`.task-list [data-task-text][data-task-id="${originId}"]`).click()
    await page.keyboard.press(branchKey)
    const first = (await branchIds(page)).at(-1)
    if (!first) throw new Error('First branch is missing')
    await settleReveal(page)

    await panPaper(page, 260, 0)
    await page.locator(`.task-list [data-task-text][data-task-id="${originId}"]`).click()
    const before = await viewport(page)
    const spot = await branchPosition(page, first)

    await page.keyboard.press(branchKey)
    const created = (await branchIds(page)).at(-1)
    if (!created) throw new Error('Second branch is missing')
    await settleReveal(page)

    // The new node started on top of the first one, so separation moved it.
    const moved = await branchPosition(page, created)
    expect([moved.x, moved.y]).not.toEqual([spot.x, spot.y])
    const after = await viewport(page)
    expect(before.x - after.x).toBeGreaterThan(40)
    const box = await rowBox(page, created)
    const area = await revealArea(page)
    expect(overflow(box, area)).toBeLessThanOrEqual(1)
  })
})
