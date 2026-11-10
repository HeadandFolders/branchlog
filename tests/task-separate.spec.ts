import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, releaseUserData, writeTask } from './launch'

declare global {
  interface Window {
    __branchlogLayout?: {
      finish: () => void
      idle: () => boolean
      generation: () => number
    }
  }
}

const GAP = 14

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface FlowPoint {
  id: string
  x: number
  y: number
}

function gap(a: Box, b: Box): number {
  const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width))
  const gapY = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  return Math.max(gapX, gapY)
}

function assertClear(boxes: Box[]): void {
  for (let i = 0; i < boxes.length; i += 1) {
    const left = boxes[i]
    if (!left) continue
    for (let j = i + 1; j < boxes.length; j += 1) {
      const right = boxes[j]
      if (!right) continue
      expect(gap(left, right)).toBeGreaterThanOrEqual(GAP)
    }
  }
}

async function nodeBoxes(page: Page, selector: string): Promise<Box[]> {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }),
  )
}

async function listBoxes(page: Page): Promise<Box[]> {
  return nodeBoxes(page, '.task-list .task-line')
}

async function branchBoxes(page: Page): Promise<Box[]> {
  return nodeBoxes(page, '.react-flow__node-branch, .react-flow__node-image')
}

async function settle(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => window.__branchlogLayout?.idle() ?? false)).toBe(true)
}

async function branchFromParent(page: Page): Promise<void> {
  await page.locator('.task-list [data-task-text]').first().click()
  await page.keyboard.press('Alt+Enter')
}

async function flowPoints(page: Page): Promise<FlowPoint[]> {
  return page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>('.react-flow__node-branch')].map((node) => {
      const match = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(node.style.transform)
      return {
        id: node.dataset.id ?? '',
        x: match ? Number(match[1]) : Number.NaN,
        y: match ? Number(match[2]) : Number.NaN,
      }
    })
  })
}

function savedPoints(userData: string): FlowPoint[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db
    .prepare(`SELECT id, x, y FROM tasks WHERE side = 'right' ORDER BY orderIndex`)
    .all() as FlowPoint[]
  db.close()
  return rows
}

async function relaunch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  await releaseUserData(userData)
  const started = await electron.launch({
    executablePath: path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
    cwd: process.cwd(),
    args: [process.cwd()],
    env: { ...process.env, BRANCHLOG_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
    timeout: 15_000,
  })
  const child = started.process()
  try {
    const page = await Promise.race([
      started.firstWindow({ timeout: 20_000 }),
      new Promise<Page>((_, reject) => {
        child.once('exit', (code) => reject(new Error(`App exited on restart (${code ?? 'none'})`)))
      }),
    ])
    await page.locator('[data-task-text], [aria-label="New task"]').first().waitFor()
    return { app: started, page }
  } catch (error) {
    if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    throw error
  }
}

async function openAgain(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  try {
    return await relaunch(userData)
  } catch {
    return relaunch(userData)
  }
}

async function drag(page: Page, from: Box, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x + 8, from.y + from.height - 8)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

test('branches created quickly from one parent do not overlap', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    const listBefore = await listBoxes(page)
    for (let count = 0; count < 4; count += 1) await branchFromParent(page)
    await settle(page)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(4)
    assertClear(await branchBoxes(page))
    const listAfter = await listBoxes(page)
    expect(listAfter).toHaveLength(listBefore.length)
    for (let index = 0; index < listBefore.length; index += 1) {
      const before = listBefore[index]
      const after = listAfter[index]
      if (!before || !after) throw new Error('Missing list row')
      expect(Math.abs(before.x - after.x)).toBeLessThan(1)
      expect(Math.abs(before.y - after.y)).toBeLessThan(1)
    }
    const parent = await page.locator('.task-list .task-line').boundingBox()
    if (!parent) throw new Error('Parent row is missing')
    for (const branch of await branchBoxes(page)) {
      expect(branch.x).toBeGreaterThanOrEqual(parent.x + parent.width - 2)
    }
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('a new branch lands level with its row and the next one beside it', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second row')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Third row')
    await page.keyboard.press('Escape')
    await settle(page)
    const parent = (await listBoxes(page))[0]
    if (!parent) throw new Error('Parent row is missing')
    await branchFromParent(page)
    await settle(page)
    const one = (await nodeBoxes(page, '.react-flow__node-branch'))[0]
    if (!one) throw new Error('First branch is missing')
    expect(Math.abs(one.y - parent.y)).toBeLessThan(2)
    expect(Math.abs(one.x - parent.x - parent.width - 16)).toBeLessThan(2)
    await branchFromParent(page)
    await settle(page)
    const boxes = (await nodeBoxes(page, '.react-flow__node-branch')).sort((a, b) => a.y - b.y)
    expect(boxes).toHaveLength(2)
    const upper = boxes[0]
    const lower = boxes[1]
    if (!upper || !lower) throw new Error('Branches are missing')
    expect(Math.abs(upper.x - lower.x)).toBeLessThan(2)
    expect(lower.y - upper.y - upper.height).toBeGreaterThanOrEqual(14)
    expect(lower.y - upper.y - upper.height).toBeLessThan(20)
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('tidy brings a branch dragged far from its row back beside it, and one undo puts it back', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await branchFromParent(page)
    await settle(page)
    const parent = (await listBoxes(page))[0]
    const branch = page.locator('.react-flow__node-branch')
    const born = await branch.boundingBox()
    if (!parent || !born) throw new Error('Parent row or branch is missing')
    const limit = await page.evaluate(() => document.documentElement.clientHeight)
    await drag(page, born, { x: born.x, y: limit - 140 })
    await settle(page)
    const far = await branch.boundingBox()
    if (!far) throw new Error('Branch is missing after the drag')
    expect(far.y).toBeGreaterThan(parent.y + 300)
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Tidy this day' }).click()
    await settle(page)
    const tidied = (await nodeBoxes(page, '.react-flow__node-branch'))[0]
    if (!tidied) throw new Error('Branch is missing after tidy')
    expect(Math.abs(tidied.y - parent.y)).toBeLessThan(2)
    expect(Math.abs(tidied.x - parent.x - parent.width - 16)).toBeLessThan(2)
    await page.keyboard.press(`${modifier}+Z`)
    await expect.poll(async () => (await branch.boundingBox())?.y ?? 0).toBeGreaterThan(parent.y + 300)
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('a dropped branch stays put and the other node slides clear', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    const listBefore = await listBoxes(page)
    await branchFromParent(page)
    await page.keyboard.type('One')
    await branchFromParent(page)
    await page.keyboard.type('Two')
    await settle(page)
    const one = page.locator('.react-flow__node-branch', { hasText: 'One' })
    const two = page.locator('.react-flow__node-branch', { hasText: 'Two' })
    const oneBefore = await one.boundingBox()
    const twoBefore = await two.boundingBox()
    if (!oneBefore || !twoBefore) throw new Error('Branches are missing')
    await drag(page, twoBefore, { x: oneBefore.x + oneBefore.width / 2, y: oneBefore.y + 16 })
    const dropped = await two.boundingBox()
    if (!dropped) throw new Error('Dropped branch is missing')
    await settle(page)
    const twoAfter = await two.boundingBox()
    const oneAfter = await one.boundingBox()
    if (!twoAfter || !oneAfter) throw new Error('Branches are missing')
    expect(Math.abs(twoAfter.x - dropped.x)).toBeLessThan(3)
    expect(Math.abs(twoAfter.y - dropped.y)).toBeLessThan(3)
    expect(gap(oneAfter, twoAfter)).toBeGreaterThanOrEqual(GAP)
    const listAfter = await listBoxes(page)
    expect(Math.abs((listAfter[0]?.y ?? 0) - (listBefore[0]?.y ?? 0))).toBeLessThan(1)
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('resizing a branch onto its neighbor separates them', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await branchFromParent(page)
    await page.keyboard.type('Top')
    await branchFromParent(page)
    await page.keyboard.type('Lower')
    await settle(page)
    const top = page.locator('.react-flow__node-branch', { hasText: 'Top' })
    const lower = page.locator('.react-flow__node-branch', { hasText: 'Lower' })
    const before = await top.boundingBox()
    if (!before) throw new Error('Branch is missing')
    await top.click({ position: { x: 8, y: 8 } })
    const handle = top.locator('.react-flow__resize-control.line.bottom')
    await expect(handle).toBeVisible()
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('Resize handle is missing')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 90, { steps: 8 })
    await page.mouse.up()
    await settle(page)
    const topAfter = await top.boundingBox()
    const lowerAfter = await lower.boundingBox()
    if (!topAfter || !lowerAfter) throw new Error('Branches are missing')
    expect(Math.abs(topAfter.y - before.y)).toBeLessThan(3)
    expect(gap(topAfter, lowerAfter)).toBeGreaterThanOrEqual(GAP)
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('a branch that grows from its text does not cover its neighbor', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await branchFromParent(page)
    await page.keyboard.type('Tall')
    await branchFromParent(page)
    await page.keyboard.type('Next')
    await settle(page)
    const tallText = page.locator('.react-flow__node-branch [data-task-text]', { hasText: 'Tall' })
    const tallId = await tallText.getAttribute('data-task-id')
    if (!tallId) throw new Error('Branch id is missing')
    const tall = page.locator(`.react-flow__node[data-id="${tallId}"]`)
    await tallText.click()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.insertText('This line is long enough to wrap the branch down across its neighbor. '.repeat(6))
    await expect.poll(async () => tall.evaluate((element) => element.offsetHeight)).toBeGreaterThan(120)
    await expect.poll(async () => {
      await page.evaluate(() => window.__branchlogLayout?.finish())
      const boxes = await branchBoxes(page)
      const left = boxes[0]
      const right = boxes[1]
      return Boolean(left && right && gap(left, right) >= GAP)
    }).toBe(true)
    await expect(tall).toContainText('wrap the branch')
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('a pasted image separates from the branch underneath it', async () => {
  const launched = await launchApp()
  const { app, page } = launched
  try {
    await writeTask(page, 'Parent')
    await branchFromParent(page)
    await settle(page)
    const branch = page.locator('.react-flow__node-branch')
    const before = await branch.boundingBox()
    if (!before) throw new Error('Branch is missing')
    await app.evaluate(async ({ ClipboardItem, clipboard, nativeImage }) => {
      const buffer = Buffer.alloc(140 * 100 * 4)
      for (let index = 0; index < buffer.length; index += 4) {
        buffer[index] = 40
        buffer[index + 1] = 90
        buffer[index + 2] = 80
        buffer[index + 3] = 255
      }
      const png = nativeImage.createFromBitmap(buffer, { width: 140, height: 100 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png]) })])
    })
    await page.mouse.click(before.x + 40, before.y + 16)
    await page.keyboard.press(`${modifier}+V`)
    await expect(page.locator('.react-flow__node-image')).toBeVisible()
    await settle(page)
    assertClear(await branchBoxes(page))
  } finally {
    await closeApp(app, launched.userData)
  }
})

test('a far branch and the main list stay where they were', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await branchFromParent(page)
    await page.keyboard.type('Far')
    await settle(page)
    const far = page.locator('.react-flow__node-branch', { hasText: 'Far' })
    const start = await far.boundingBox()
    if (!start) throw new Error('Branch is missing')
    await drag(page, start, { x: start.x + 520, y: start.y + 40 })
    await settle(page)
    const parked = await far.boundingBox()
    const listParked = await listBoxes(page)
    if (!parked) throw new Error('Branch is missing')
    for (let count = 0; count < 3; count += 1) await branchFromParent(page)
    await settle(page)
    const parkedAfter = await far.boundingBox()
    if (!parkedAfter) throw new Error('Branch is missing')
    expect(Math.abs(parkedAfter.x - parked.x)).toBeLessThan(2)
    expect(Math.abs(parkedAfter.y - parked.y)).toBeLessThan(2)
    assertClear(await branchBoxes(page))
    const listAfter = await listBoxes(page)
    expect(Math.abs((listAfter[0]?.x ?? 0) - (listParked[0]?.x ?? 0))).toBeLessThan(1)
    expect(Math.abs((listAfter[0]?.y ?? 0) - (listParked[0]?.y ?? 0))).toBeLessThan(1)
    const listNode = await page.locator('.react-flow__node-mainList').evaluate((node) => node.style.transform)
    expect(listNode).toMatch(/translate(?:3d)?\(\s*0px,\s*0px/)
    const parent = listAfter[0]
    if (!parent) throw new Error('Parent row is missing')
    for (const branch of await nodeBoxes(page, '.react-flow__node-branch')) {
      expect(branch.x).toBeGreaterThanOrEqual(parent.x + parent.width - 2)
    }
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('settled positions survive a restart', async () => {
  const launched = await launchApp()
  let { app, page, userData } = launched
  try {
    await writeTask(page, 'Parent')
    for (let count = 0; count < 3; count += 1) await branchFromParent(page)
    await settle(page)
    const before = savedPoints(userData)
    expect(before).toHaveLength(3)
    const shown = await flowPoints(page)
    expect(shown.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
    await closeApp(app, userData, true)
    await rm(path.join(userData, 'lockfile'), { force: true }).catch(() => undefined)
    const again = await openAgain(userData)
    app = again.app
    page = again.page
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(3)
    const after = savedPoints(userData)
    expect(after).toEqual(before)
    const restored = await flowPoints(page)
    for (const point of before) {
      const match = restored.find((item) => item.id === point.id)
      expect(match).toBeTruthy()
      expect(match && Math.abs(match.x - point.x)).toBeLessThan(0.5)
      expect(match && Math.abs(match.y - point.y)).toBeLessThan(0.5)
    }
  } finally {
    await closeApp(app, userData)
  }
})

test('one undo restores a pushed layout and redo applies it again', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await branchFromParent(page)
    await page.keyboard.type('Keep')
    await branchFromParent(page)
    await page.keyboard.type('Move')
    await settle(page)
    const before = await flowPoints(page)
    const keep = page.locator('.react-flow__node-branch', { hasText: 'Keep' })
    const move = page.locator('.react-flow__node-branch', { hasText: 'Move' })
    const keepBox = await keep.boundingBox()
    const moveBox = await move.boundingBox()
    if (!keepBox || !moveBox) throw new Error('Branches are missing')
    await drag(page, moveBox, { x: keepBox.x + 20, y: keepBox.y + 12 })
    await settle(page)
    const pushed = await flowPoints(page)
    await page.keyboard.press(`${modifier}+Z`)
    await settle(page)
    const undone = await flowPoints(page)
    for (const point of before) {
      const match = undone.find((item) => item.id === point.id)
      expect(match).toBeTruthy()
      expect(match && Math.abs(match.x - point.x)).toBeLessThan(1)
      expect(match && Math.abs(match.y - point.y)).toBeLessThan(1)
    }
    await page.keyboard.press(`${modifier}+Y`)
    await settle(page)
    const redone = await flowPoints(page)
    for (const point of pushed) {
      const match = redone.find((item) => item.id === point.id)
      expect(match).toBeTruthy()
      expect(match && Math.abs(match.x - point.x)).toBeLessThan(1)
      expect(match && Math.abs(match.y - point.y)).toBeLessThan(1)
    }
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('the glide stops and then nothing keeps moving', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await branchFromParent(page)
    await branchFromParent(page)
    await settle(page)
    const first = await flowPoints(page)
    await page.waitForTimeout(500)
    const second = await flowPoints(page)
    expect(second).toEqual(first)
    expect(await page.evaluate(() => window.__branchlogLayout?.idle() ?? false)).toBe(true)
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('auto-separate can be turned off', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Auto-separate nodes' }).click()
    await page.keyboard.press('Escape')
    await branchFromParent(page)
    await branchFromParent(page)
    await settle(page)
    const boxes = await nodeBoxes(page, '.react-flow__node-branch')
    expect(boxes).toHaveLength(2)
    const left = boxes[0]
    const right = boxes[1]
    if (!left || !right) throw new Error('Branches are missing')
    expect(gap(left, right)).toBeLessThan(GAP)
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})

test('a crowded page still settles quickly and typing stays responsive', async () => {
  test.setTimeout(120_000)
  const launched = await launchApp()
  let { app, page, userData } = launched
  try {
    await closeApp(app, userData, true)
    const date = new Date()
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const file = path.join(userData, 'branchlog.sqlite')
    let db: Database.Database | null = null
    let opened: unknown
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        db = new Database(file)
        db.pragma('busy_timeout = 3000')
        db.prepare('SELECT 1').get()
        break
      } catch (error) {
        opened = error
        db?.close()
        db = null
        await rm(`${file}-wal`, { force: true }).catch(() => undefined)
        await rm(`${file}-shm`, { force: true }).catch(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    if (!db) throw opened
    const parent = randomUUID()
    const insert = db.prepare(
      `INSERT INTO tasks (
         id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex
       ) VALUES (?, ?, 0, ?, NULL, ?, ?, ?, 240, 0, ?, ?)`,
    )
    const seed = db.transaction(() => {
      insert.run(parent, 'Parent', today, null, 0, 0, 'main', 0)
      for (let index = 0; index < 300; index += 1) {
        const column = index % 15
        const row = Math.floor(index / 15)
        insert.run(randomUUID(), `N${index}`, today, parent, 1500 + column * 300, row * 90, 'right', index)
      }
    })
    seed()
    db.close()
    const again = await openAgain(userData)
    app = again.app
    page = again.page
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(300)
    const started = Date.now()
    await branchFromParent(page)
    await settle(page)
    const elapsed = Date.now() - started
    console.log(`separate-perf-create-ms ${elapsed}`)
    expect(elapsed).toBeLessThan(1_000)
    const typed = Date.now()
    await page.locator('.task-list [data-task-text]').click()
    await page.keyboard.type('q')
    await expect(page.locator('.task-list [data-task-text]')).toContainText('q')
    const typing = Date.now() - typed
    console.log(`separate-perf-type-ms ${typing}`)
    expect(typing).toBeLessThan(600)
  } finally {
    await closeApp(app, userData)
  }
})

test('the layout hook finishes the simulation immediately', async () => {
  const launched = await launchApp()
  const { page } = launched
  try {
    await writeTask(page, 'Parent')
    await page.evaluate(() => {
      const hook = window.__branchlogLayout
      if (!hook) throw new Error('Layout hook is missing')
      hook.finish()
    })
    await branchFromParent(page)
    await page.evaluate(() => window.__branchlogLayout?.finish())
    await branchFromParent(page)
    await page.evaluate(() => window.__branchlogLayout?.finish())
    await settle(page)
    assertClear(await branchBoxes(page))
  } finally {
    await closeApp(launched.app, launched.userData)
  }
})
