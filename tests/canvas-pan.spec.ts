import { spawnSync } from 'node:child_process'
import path from 'node:path'
import Database from 'better-sqlite3'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, releaseUserData, writeTask } from './launch'

const LONG = 'This line is long enough to scroll inside the branch. '.repeat(8)

test.describe('canvas pan', () => {
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

  test('a vertical wheel pans and does not zoom', async () => {
    await writeTask(page, 'alpha')
    await page.keyboard.press('Escape')
    const point = await emptyPoint(page)
    const before = await viewport(page)
    await wheel(page, point, 0, 140)
    const after = await viewport(page)
    expect(after.zoom).toBeCloseTo(before.zoom, 2)
    expect(after.y).toBeLessThan(before.y - 40)
    expect(after.x).toBeCloseTo(before.x, 0)
  })

  test('horizontal and diagonal wheels pan without zooming', async () => {
    await page.keyboard.press('Escape')
    const point = await emptyPoint(page)
    const before = await viewport(page)
    await wheel(page, point, 160, 0)
    const across = await viewport(page)
    expect(across.zoom).toBeCloseTo(before.zoom, 2)
    expect(across.x).toBeLessThan(before.x - 40)
    expect(across.y).toBeCloseTo(before.y, 0)
    await wheel(page, point, 90, 110)
    const diagonal = await viewport(page)
    expect(diagonal.zoom).toBeCloseTo(before.zoom, 2)
    expect(diagonal.x).toBeLessThan(across.x - 20)
    expect(diagonal.y).toBeLessThan(across.y - 20)
  })

  test('ctrl and meta pinch zoom the canvas and do not pan it', async () => {
    await page.keyboard.press('Escape')
    const point = await emptyPoint(page)
    const before = await viewport(page)
    const spot = await flowPoint(page, point)
    await pinch(page, point, -80, false)
    const pinched = await viewport(page)
    const held = await flowPoint(page, point)
    expect(pinched.zoom).toBeGreaterThan(before.zoom + 0.05)
    expect(Math.abs(held.fx - spot.fx)).toBeLessThan(4)
    expect(Math.abs(held.fy - spot.fy)).toBeLessThan(4)

    if (process.platform === 'darwin') {
      const framed = await viewport(page)
      await page.keyboard.down('Meta')
      await page.waitForTimeout(200)
      await pinch(page, point, -40, true)
      await page.keyboard.up('Meta')
      const meta = await viewport(page)
      expect(meta.zoom).toBeGreaterThan(framed.zoom + 0.02)
    }
  })

  test('a pinch does not zoom the window', async () => {
    await page.keyboard.press('Escape')
    const point = await emptyPoint(page)
    await page.keyboard.down('Control')
    await page.waitForTimeout(200)
    await wheel(page, point, 0, -100)
    await page.keyboard.up('Control')
    await pinch(page, point, -80, false)
    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 0)
    const factor = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0)
    expect(scale).toBe(1)
    expect(factor).toBe(1)
  })

  test('a wheel over scrolling content scrolls that content and leaves the canvas', async () => {
    await writeTask(page, 'Origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const text = page.locator('.react-flow__node-branch [data-task-text]')
    await text.click()
    await page.keyboard.insertText(LONG)
    await expect(text).toHaveText(LONG)
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.__branchlogLayout?.finish())
    await expect.poll(() => page.evaluate(() => window.__branchlogLayout?.idle() ?? true)).toBe(true)
    await text.evaluate((element) => {
      const node = element as HTMLElement
      node.style.maxHeight = '36px'
      node.style.overflowY = 'auto'
    })
    const box = await text.boundingBox()
    if (!box) throw new Error('Branch text is missing')
    const textPoint = { x: box.x + Math.min(box.width / 2, 80), y: box.y + Math.min(14, box.height / 2) }
    await frames(page)
    const before = await viewport(page)
    await wheel(page, textPoint, 0, 80)
    let scrolled = await text.evaluate((element) => element.scrollTop)
    if (scrolled <= 8) {
      await wheel(page, textPoint, 0, 80)
      scrolled = await text.evaluate((element) => element.scrollTop)
    }
    const after = await viewport(page)
    expect(scrolled).toBeGreaterThan(8)
    expect(after.x).toBeCloseTo(before.x, 0)
    expect(after.y).toBeCloseTo(before.y, 0)
    expect(after.zoom).toBeCloseTo(before.zoom, 2)

    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Theme Lab' }).click()
    const lab = page.locator('.theme-lab')
    await expect(lab).toBeVisible()
    await lab.evaluate((element) => {
      element.style.top = '40px'
      element.style.bottom = 'auto'
      element.style.height = '160px'
      element.style.overflowY = 'auto'
    })
    const body = await lab.locator('.theme-lab-body').boundingBox()
    const shell = await lab.boundingBox()
    if (!body || !shell) throw new Error('Theme Lab body is missing')
    const labPoint = {
      x: shell.x + 24,
      y: Math.min(body.y + 24, shell.y + shell.height - 16),
    }
    await frames(page)
    const parked = await viewport(page)
    await wheel(page, labPoint, 0, 100)
    let labTop = await lab.evaluate((element) => element.scrollTop)
    if (labTop <= 8) {
      await wheel(page, labPoint, 0, 100)
      labTop = await lab.evaluate((element) => element.scrollTop)
    }
    const still = await viewport(page)
    expect(labTop).toBeGreaterThan(8)
    expect(still.x).toBeCloseTo(parked.x, 0)
    expect(still.y).toBeCloseTo(parked.y, 0)
    expect(still.zoom).toBeCloseTo(parked.zoom, 2)
  })

  test('turning the setting off makes a plain wheel zoom', async () => {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Menu' }).click()
    const item = page.getByRole('menuitemcheckbox', { name: /Trackpad: swipe to pan/ })
    await expect(item).toHaveAttribute('aria-checked', 'true')
    await item.click()
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-swipe-pan="0"]')).toBeVisible()
    await frames(page)
    const point = await emptyPoint(page)
    const before = await viewport(page)
    await wheel(page, point, 0, -120)
    const after = await viewport(page)
    expect(after.zoom).toBeGreaterThan(before.zoom + 0.05)
    expect(settingValue(userData)).toBe('0')
  })

  test('panning does not write or re-render nodes', async () => {
    await writeTask(page, 'Still')
    await page.keyboard.press('Escape')
    await expect.poll(() => savedText(userData)).toBe('Still')
    await frames(page)
    const calls = await ipcCalls(app)
    const renders = await renderCounts(page)
    expect(calls).toBeGreaterThan(0)
    expect(renders.bullet).toBeGreaterThan(0)
    const point = await emptyPoint(page)
    for (let i = 0; i < 6; i += 1) await wheel(page, point, i % 2 === 0 ? 30 : 0, 40)
    await page.waitForTimeout(250)
    expect(await ipcCalls(app)).toBe(calls)
    expect(await renderCounts(page)).toEqual(renders)
    expect(savedText(userData)).toBe('Still')
  })

  test('the setting survives a restart and the canvas is framed again', async () => {
    await page.keyboard.press('Escape')
    const opened = await viewport(page)
    const point = await emptyPoint(page)
    await wheel(page, point, 0, 180)
    const panned = await viewport(page)
    expect(panned.y).toBeLessThan(opened.y - 40)
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitemcheckbox', { name: /Trackpad: swipe to pan/ }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => settingValue(userData)).toBe('0')
    await closeApp(app, userData, true)
    const next = await relaunch(userData)
    app = next.app
    page = next.page
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Trackpad: swipe to pan/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-swipe-pan="0"]')).toBeVisible()
    const framed = await viewport(page)
    expect(framed.zoom).toBeCloseTo(1, 2)
    expect(framed.y).toBeGreaterThan(panned.y + 40)
    expect(Math.abs(framed.y - opened.y)).toBeLessThan(40)
    const spot = await emptyPoint(page)
    await wheel(page, spot, 0, -100)
    const zoomed = await viewport(page)
    expect(zoomed.zoom).toBeGreaterThan(1.05)
  })
})

async function relaunch(dir: string): Promise<{ app: ElectronApplication; page: Page }> {
  await releaseUserData(dir)
  const started = await electron.launch({
    executablePath: path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
    cwd: process.cwd(),
    args: [process.cwd()],
    env: { ...process.env, BRANCHLOG_USER_DATA: dir, ELECTRON_RENDERER_URL: '' },
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
      started.firstWindow({ timeout: 20_000 }),
      new Promise<Page>((_, reject) => {
        child.once('exit', (code) => reject(new Error(`App exited on restart (${code})`)))
      }),
    ])
    await next.locator('[data-task-text], [aria-label="New task"]').first().waitFor()
    return { app: started, page: next }
  } catch (error) {
    if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    throw new Error(`${error instanceof Error ? error.message : 'Restart failed'}\n${logs}`)
  }
}

async function frames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) return null
    const rect = pane.getBoundingClientRect()
    for (let y = rect.top + 48; y < rect.bottom - 32; y += 28) {
      for (let x = rect.left + 20; x < rect.right - 20; x += 36) {
        const el = document.elementFromPoint(x, y)
        if (!el) continue
        if (el.closest('.react-flow__node, .react-flow__attribution, .theme-lab, [role="menu"], .react-flow__minimap')) {
          continue
        }
        if (el.closest('.react-flow__pane, .react-flow__renderer')) return { x, y }
      }
    }
    return null
  })
  if (!point) throw new Error('No empty canvas point')
  return point
}

async function viewport(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const node = document.querySelector('.react-flow__viewport')
    if (!(node instanceof HTMLElement)) throw new Error('Missing viewport')
    const transform = node.style.transform
    const move = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(transform)
    const zoom = /scale\(\s*([-\d.]+)\s*\)/.exec(transform)
    if (!move || !zoom) throw new Error(`Unexpected transform ${transform}`)
    return { x: Number(move[1]), y: Number(move[2]), zoom: Number(zoom[1]) }
  })
}

async function flowPoint(page: Page, point: { x: number; y: number }): Promise<{ fx: number; fy: number }> {
  return page.evaluate(({ x, y }) => {
    const flow = document.querySelector('.react-flow')
    const node = document.querySelector('.react-flow__viewport')
    if (!(flow instanceof HTMLElement) || !(node instanceof HTMLElement)) throw new Error('Missing canvas')
    const rect = flow.getBoundingClientRect()
    const move = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(node.style.transform)
    const zoom = Number(/scale\(\s*([-\d.]+)\s*\)/.exec(node.style.transform)?.[1])
    if (!move || !Number.isFinite(zoom) || zoom === 0) throw new Error(node.style.transform)
    return { fx: (x - rect.left - Number(move[1])) / zoom, fy: (y - rect.top - Number(move[2])) / zoom }
  }, point)
}

async function wheel(page: Page, point: { x: number; y: number }, deltaX: number, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y)
  await page.mouse.wheel(deltaX, deltaY)
}

async function pinch(page: Page, point: { x: number; y: number }, deltaY: number, meta: boolean): Promise<void> {
  await page.mouse.move(point.x, point.y)
  await page.evaluate(
    ({ x, y, deltaY, meta }) => {
      const element = document.elementFromPoint(x, y)
      if (!element) throw new Error('No pinch target')
      element.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          deltaY,
          ctrlKey: !meta,
          metaKey: meta,
        }),
      )
    },
    { x: point.x, y: point.y, deltaY, meta },
  )
}

async function ipcCalls(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => {
    const read = (globalThis as { __branchlogIpcCalls?: () => number }).__branchlogIpcCalls
    return read ? read() : -1
  })
}

async function renderCounts(page: Page): Promise<{ branch: number; list: number; bullet: number }> {
  return page.evaluate(() => {
    const live = (globalThis as { __blRenders?: Record<string, number> }).__blRenders ?? {}
    return {
      branch: live.BranchNode ?? 0,
      list: live.MainListNode ?? 0,
      bullet: live.TaskBullet ?? 0,
    }
  })
}

function settingValue(dir: string): string | null {
  const db = new Database(path.join(dir, 'branchlog.sqlite'), { readonly: true, fileMustExist: true })
  db.pragma('busy_timeout = 3000')
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'swipeToPan'`).get() as { value: string } | undefined
  db.close()
  return row?.value ?? null
}

function savedText(dir: string): string | null {
  const db = new Database(path.join(dir, 'branchlog.sqlite'), { readonly: true, fileMustExist: true })
  db.pragma('busy_timeout = 3000')
  const row = db.prepare(`SELECT text FROM tasks LIMIT 1`).get() as { text: string } | undefined
  db.close()
  return row?.text ?? null
}
