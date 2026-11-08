import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

const LONG =
  'This branch should wrap onto several lines instead of being squeezed into a tiny box. '.repeat(4)

async function relaunch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  await rm(path.join(userData, 'lockfile'), { force: true }).catch(() => undefined)
  const started = await electron.launch({
    executablePath: path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
    cwd: process.cwd(),
    args: [process.cwd()],
    env: { ...process.env, BRANCHLOG_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
    timeout: 15_000,
  })
  const child = started.process()
  let logs = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    logs += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    logs += chunk.toString()
  })
  try {
    const next = await Promise.race([
      started.firstWindow({ timeout: 10_000 }),
      new Promise<Page>((_, reject) => {
        child.once('exit', (code) => reject(new Error(`App exited on restart (${code})`)))
      }),
    ])
    return { app: started, page: next }
  } catch (error) {
    if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    throw new Error(`${error instanceof Error ? error.message : 'Restart failed'}\n${logs}`)
  }
}

function openDb(userData: string): Database.Database {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  return db
}

function savedSize(userData: string, id: string): { width: number; height: number } | null {
  const db = openDb(userData)
  const row = db.prepare('SELECT width, height FROM tasks WHERE id = ?').get(id) as
    | { width: number; height: number }
    | undefined
  db.close()
  return row ?? null
}

async function edgePoint(page: Page, edgeId: string, at: 'start' | 'end'): Promise<{ x: number; y: number }> {
  return page.locator(`[data-testid="rf__edge-${edgeId}"] .react-flow__edge-path`).evaluate((path, end) => {
    const element = path as SVGPathElement
    const point = element.getPointAtLength(end ? element.getTotalLength() : 0)
    const matrix = element.getScreenCTM()
    if (!matrix) throw new Error('Missing edge')
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix)
    return { x: screen.x, y: screen.y }
  }, at === 'end')
}

test('a branch reads as a task line, wraps, resizes, and keeps its arrow on the checkbox', async () => {
  const launched = await launchApp()
  const { page } = launched
  let { app, userData } = launched
  try {
    await writeTask(page, 'Origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branch = page.locator('.react-flow__node-branch').first()
    const text = branch.locator('[data-task-text]')
    await expect(text).toBeVisible()
    await page.keyboard.type('Hi')
    await expect(text).toHaveText('Hi')
    const branchId = await text.getAttribute('data-task-id')
    if (!branchId) throw new Error('Branch id is missing')

    await expect(page.locator('.react-flow__node-mainList .react-flow__resize-control')).toHaveCount(0)
    await expect(branch.locator('.react-flow__resize-control')).toHaveCount(0)
    const font = await text.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    const box = await branch.evaluate((element) => ({
      width: element.offsetWidth,
      height: element.offsetHeight,
      border: getComputedStyle(element).borderTopWidth,
      outline: getComputedStyle(element).outlineStyle,
    }))
    expect(font).toBeGreaterThanOrEqual(15)
    expect(font).toBeLessThanOrEqual(16)
    expect(box.width).toBeGreaterThanOrEqual(232)
    expect(box.width).toBeLessThanOrEqual(248)
    expect(box.height).toBeLessThan(80)
    expect(box.border).toBe('0px')
    expect(box.outline).toBe('none')
    const shortClip = await text.evaluate((element) => element.scrollHeight - element.clientHeight)
    expect(shortClip).toBeLessThanOrEqual(1)

    await text.click()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.insertText(LONG)
    await expect(text).toHaveText(LONG)
    const tall = await branch.evaluate((element) => element.offsetHeight)
    const wrapped = await text.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const lines = range.getClientRects().length
      return { lines, clip: element.scrollHeight - element.clientHeight }
    })
    expect(tall).toBeGreaterThan(box.height + 30)
    expect(wrapped.lines).toBeGreaterThan(2)
    expect(wrapped.clip).toBeLessThanOrEqual(1)

    const checkbox = branch.locator('.task-check')
    const check = await checkbox.boundingBox()
    const node = await branch.boundingBox()
    if (!check || !node) throw new Error('Branch box is missing')
    const end = await edgePoint(page, `edge-${branchId}`, 'end')
    expect(Math.abs(end.y - (check.y + check.height / 2))).toBeLessThan(14)
    expect(Math.abs(end.x - node.x)).toBeLessThan(18)
    expect(Math.abs(end.y - (node.y + node.height / 2))).toBeGreaterThan(24)

    await branch.click({ position: { x: 6, y: 6 } })
    const handle = branch.locator('.react-flow__resize-control.line.right')
    await expect(handle).toBeVisible()
    const selectedOutline = await branch.evaluate((element) => getComputedStyle(element).outlineStyle)
    expect(selectedOutline).toBe('solid')
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('Resize handle is missing')
    const beforeNarrow = await branch.evaluate((element) => element.offsetHeight)
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x - 90, handleBox.y + handleBox.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(async () => branch.evaluate((element) => element.offsetWidth)).toBeLessThan(200)
    const narrow = await branch.evaluate((element) => ({
      width: element.offsetWidth,
      height: element.offsetHeight,
    }))
    const narrowClip = await text.evaluate((element) => element.scrollHeight - element.clientHeight)
    expect(narrow.width).toBeGreaterThanOrEqual(140)
    expect(narrow.height).toBeGreaterThan(beforeNarrow + 10)
    expect(narrowClip).toBeLessThanOrEqual(1)

    await expect.poll(() => savedSize(userData, branchId)?.width ?? 0).toBeLessThan(200)
    const stored = savedSize(userData, branchId)
    if (!stored) throw new Error('Saved size is missing')
    expect(stored.width).toBeGreaterThanOrEqual(140)
    expect(stored.height).toBeGreaterThan(beforeNarrow)

    const parentDot = branch.locator('.branch-dot')
    await parentDot.click()
    const child = page.locator('.react-flow__node-branch').nth(1)
    const childText = child.locator('[data-task-text]')
    await expect(childText).toBeVisible()
    await page.keyboard.type('Next')
    await expect(childText).toHaveText('Next')
    const childId = await childText.getAttribute('data-task-id')
    if (!childId) throw new Error('Child id is missing')
    const childCheck = await child.locator('.task-check').boundingBox()
    const childNode = await child.boundingBox()
    const dot = await parentDot.boundingBox()
    const parentNode = await branch.boundingBox()
    if (!childCheck || !childNode || !dot || !parentNode) throw new Error('Nested branch box is missing')
    const nestedEnd = await edgePoint(page, `edge-${childId}`, 'end')
    const nestedStart = await edgePoint(page, `edge-${childId}`, 'start')
    expect(Math.abs(nestedEnd.y - (childCheck.y + childCheck.height / 2))).toBeLessThan(14)
    expect(Math.abs(nestedEnd.x - childNode.x)).toBeLessThan(18)
    expect(Math.abs(nestedStart.y - (dot.y + dot.height / 2))).toBeLessThan(14)
    expect(Math.abs(nestedStart.y - (parentNode.y + parentNode.height / 2))).toBeGreaterThan(24)
    expect(nestedStart.x).toBeLessThan(nestedEnd.x)

    await closeApp(app, userData, true)
    const again = await relaunch(userData)
    app = again.app
    userData = again.userData
    const restored = again.page.locator('.react-flow__node-branch', { hasText: 'several lines' })
    await expect(restored).toBeVisible()
    const restoredWidth = await restored.evaluate((element) => element.offsetWidth)
    expect(Math.abs(restoredWidth - stored.width)).toBeLessThanOrEqual(2)
    const restoredClip = await restored.locator('[data-task-text]').evaluate((element) => element.scrollHeight - element.clientHeight)
    expect(restoredClip).toBeLessThanOrEqual(1)
  } finally {
    await closeApp(app, userData)
  }
})

test('an older notebook gets a default branch size', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'branchlog-e2e-'))
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
      dateCreated TEXT NOT NULL,
      dateCompleted TEXT,
      parentId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      side TEXT NOT NULL DEFAULT 'main' CHECK (side IN ('main', 'right')),
      orderIndex INTEGER NOT NULL DEFAULT 0
    );
  `)
  db.prepare(
    `INSERT INTO tasks (
       id, text, done, dateCreated, dateCompleted, parentId, x, y, side, orderIndex
     ) VALUES ('parent', 'Parent', 0, '2024-01-02', NULL, NULL, 0, 0, 'main', 0)`,
  ).run()
  db.prepare(
    `INSERT INTO tasks (
       id, text, done, dateCreated, dateCompleted, parentId, x, y, side, orderIndex
     ) VALUES ('branch', 'Branch', 0, '2024-01-02', NULL, 'parent', 40, 20, 'right', 0)`,
  ).run()
  db.close()

  const launched = await launchApp(userData)
  try {
    const check = openDb(userData)
    const columns = check.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    const row = check.prepare('SELECT width, height FROM tasks WHERE id = ?').get('branch') as {
      width: number
      height: number
    }
    check.close()
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['width', 'height']),
    )
    expect(row).toEqual({ width: 240, height: 0 })
  } finally {
    await closeApp(launched.app, userData)
  }
})
