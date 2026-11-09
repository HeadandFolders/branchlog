import { expect, test, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

const ORIGINAL = 'Original branch content to remove. '.repeat(6)

async function fixture(page: Page) {
  const text = await writeTask(page, 'Parent')
  const parentId = await text.getAttribute('data-task-id')
  if (!parentId) throw new Error('Parent id is missing')
  const seeded = await page.evaluate(({ parentId, original }) => {
    const list = document.querySelector('.react-flow__node-mainList')!
    const line = document.querySelector('.task-list .task-line')!
    const listBox = list.getBoundingClientRect()
    const lineBox = line.getBoundingClientRect()
    const x = lineBox.right - listBox.left + 16
    const y = lineBox.top - listBox.top
    const large = crypto.randomUUID()
    const peer = crypto.randomUUID()
    const child = crypto.randomUUID()
    const far = crypto.randomUUID()
    window.branchlog.tasks.createBranchSync({ id: large, parentId, text: original, x, y })
    window.branchlog.tasks.updateSync({ id: large, height: 480 })
    window.branchlog.tasks.createBranchSync({ id: peer, parentId, text: 'Neighbor', x, y: y + 496 })
    window.branchlog.tasks.createBranchSync({ id: child, parentId: large, text: 'Child', x: x + 420, y: y + 200 })
    window.branchlog.tasks.createBranchSync({ id: far, parentId, text: 'Far away', x: x + 3000, y })
    return { large, peer, child, far, x, y }
  }, { parentId, original: ORIGINAL })
  await page.getByRole('button', { name: 'Next day' }).click()
  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(page.locator('.react-flow__node-branch')).toHaveCount(4)
  await expect(page.locator(`[data-id="${seeded.large}"] [data-task-text]`)).toHaveText(ORIGINAL)
  return seeded
}

async function positions(page: Page) {
  return page.locator('.react-flow__node-branch').evaluateAll((nodes) => nodes.map((node) => {
    const element = node as HTMLElement
    const match = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(element.style.transform)
    if (!match) throw new Error('Node position is missing')
    return { id: element.dataset.id!, x: Number(match[1]), y: Number(match[2]) }
  }))
}

async function expectClear(page: Page) {
  const boxes = await page.locator('.react-flow__node-branch, .task-list .task-line').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }))
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!
      const b = boxes[j]!
      const dx = Math.max(a.x - b.x - b.width, b.x - a.x - a.width)
      const dy = Math.max(a.y - b.y - b.height, b.y - a.y - a.height)
      expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(14)
    }
  }
}

test('shrinking a branch brings nearby branches toward parents, with undo, redo, and restart', async () => {
  const launched = await launchApp()
  let { app, page, userData } = launched
  try {
    const ids = await fixture(page)
    const large = page.locator(`[data-id="${ids.large}"]`)
    const field = large.locator('[data-task-text]')
    const before = await positions(page)
    await expect.poll(() => large.evaluate((node) => (node as HTMLElement).offsetHeight)).toBe(480)
    await field.click()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.insertText('Short')
    await expect.poll(() => large.evaluate((node) => (node as HTMLElement).offsetHeight)).toBeLessThan(80)
    await expect.poll(async () => {
      const peer = (await positions(page)).find((point) => point.id === ids.peer)!
      return Math.hypot(peer.x - ids.x, peer.y - ids.y)
    }).toBeLessThan(80)
    await expect.poll(() => page.evaluate(() => window.__branchlogLayout?.idle())).toBe(true)
    const after = await positions(page)
    const peer = after.find((point) => point.id === ids.peer)!
    const child = after.find((point) => point.id === ids.child)!
    expect(Math.abs(peer.x - ids.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(child.x - ids.x - 256)).toBeLessThanOrEqual(1)
    expect(Math.abs(child.y - ids.y)).toBeLessThanOrEqual(1)
    expect(after.find((point) => point.id === ids.large)).toEqual(before.find((point) => point.id === ids.large))
    expect(after.find((point) => point.id === ids.far)).toEqual(before.find((point) => point.id === ids.far))
    await expectClear(page)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(field).toHaveText(ORIGINAL)
    await expect.poll(() => positions(page)).toEqual(before)
    await page.keyboard.press(`${modifier}+Y`)
    await expect(field).toHaveText('Short')
    await expect.poll(() => positions(page)).toEqual(after)
    await expectClear(page)
    await closeApp(app, userData, true)
    const again = await launchApp(userData)
    app = again.app
    page = again.page
    userData = again.userData
    await expect(page.locator(`[data-id="${ids.large}"] [data-task-text]`)).toHaveText('Short')
    await expect.poll(() => positions(page)).toEqual(after)
    await expectClear(page)
  } finally {
    await closeApp(app, userData)
  }
})

test('manual height reduction compacts neighbors after the resize ends', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    const ids = await fixture(page)
    const large = page.locator(`[data-id="${ids.large}"]`)
    await large.click({ position: { x: 6, y: 6 } })
    const handle = large.locator('.react-flow__resize-control.line.bottom')
    await expect(handle).toBeVisible()
    const box = await handle.boundingBox()
    if (!box) throw new Error('Resize handle is missing')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y - 140, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => large.evaluate((node) => (node as HTMLElement).offsetHeight)).toBeLessThan(420)
    await expect.poll(async () => {
      const peer = (await positions(page)).find((point) => point.id === ids.peer)!
      return Math.hypot(peer.x - ids.x, peer.y - ids.y)
    }).toBeLessThan(496)
    await expect.poll(() => page.evaluate(() => window.__branchlogLayout?.idle())).toBe(true)
    await expectClear(page)
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('turning auto-separate off leaves neighbors in place after shrinking', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    const ids = await fixture(page)
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Auto-separate nodes' }).click()
    await page.keyboard.press('Escape')
    const before = await positions(page)
    const large = page.locator(`[data-id="${ids.large}"]`)
    await large.locator('[data-task-text]').click()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.insertText('Short')
    await expect.poll(() => large.evaluate((node) => (node as HTMLElement).offsetHeight)).toBeLessThan(80)
    await expect.poll(() => page.evaluate(() => window.__branchlogLayout?.idle())).toBe(true)
    expect(await positions(page)).toEqual(before)
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})
