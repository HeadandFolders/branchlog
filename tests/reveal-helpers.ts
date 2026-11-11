import { randomUUID } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, type Page } from '@playwright/test'
import { applySchema } from '../src/main/schema'
import { localDateKey } from '../src/shared/dates'

// Mirrors the insets in src/renderer/src/lib/reveal-viewport.ts: the far edges keep
// 80px of air, the near edges only a small clear zone, and a new row lands 40% of
// the pane above its bottom.
const MARGIN_PX = 80
const NEAR_PX = 24
const ANCHOR_TOP = 0.6

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface MotionStop extends Viewport {
  at: number
}

interface SeedTask {
  id: string
  text: string
  orderIndex: number
  side?: 'main' | 'right'
  parentId?: string | null
  x?: number
  y?: number
  height?: number
}

interface MotionWindow {
  __revealMotion?: {
    sampling: boolean
    stops: { at: number; transform: string }[]
  }
  __branchlogReveal?: { busy: () => boolean }
}

export function seedTasks(userData: string, seeds: SeedTask[]): void {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  const dateKey = localDateKey()
  db.pragma('busy_timeout = 3000')
  db.pragma('foreign_keys = ON')
  applySchema(db)
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('autoCarry', '0')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run()
  const insert = db.prepare(
    `INSERT INTO tasks (id, text, dateCreated, parentId, side, chainId, orderIndex, x, y, height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const seed of seeds) {
    insert.run(
      seed.id,
      seed.text,
      dateKey,
      seed.parentId ?? null,
      seed.side ?? 'main',
      seed.id,
      seed.orderIndex,
      seed.x ?? 0,
      seed.y ?? 0,
      seed.height ?? 0,
    )
  }
  db.close()
}

// Rows are tall enough that the end of the list sits well below the window.
export function seedMainList(userData: string, count: number): string[] {
  const seeds: SeedTask[] = []
  for (const index of Array.from({ length: count }, (_unused, step) => step)) {
    seeds.push({ id: randomUUID(), text: `Seed ${String(index + 1).padStart(2, '0')}`, orderIndex: index })
  }
  seedTasks(userData, seeds)
  return seeds.map((seed) => seed.id)
}

function parseTransform(transform: string): Viewport {
  const move = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(transform)
  const zoom = /scale\(\s*([-\d.]+)\s*\)/.exec(transform)
  if (!move || !zoom) throw new Error(`Unexpected transform ${transform}`)
  return { x: Number(move[1]), y: Number(move[2]), zoom: Number(zoom[1]) }
}

export async function viewport(page: Page): Promise<Viewport> {
  const transform = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!node) throw new Error('Missing viewport')
    return node.style.transform
  })
  return parseTransform(transform)
}

export async function paneBox(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('[data-swipe-pan]')
    if (!pane) throw new Error('Missing canvas pane')
    const rect = pane.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
  })
}

export async function revealArea(page: Page): Promise<Box> {
  const pane = await paneBox(page)
  const far = Math.min(MARGIN_PX, (pane.right - pane.left) / 4, (pane.bottom - pane.top) / 4)
  const near = Math.min(NEAR_PX, (pane.right - pane.left) / 8, (pane.bottom - pane.top) / 8)
  return { left: pane.left + near, right: pane.right - far, top: pane.top + near, bottom: pane.bottom - far }
}

// The writing line a new row is parked on: 60% of the pane below its top, which is
// the same place reveal-viewport's ANCHOR_TOP puts it.
export async function revealAnchor(page: Page): Promise<number> {
  const pane = await paneBox(page)
  return pane.top + (pane.bottom - pane.top) * ANCHOR_TOP
}

export async function rowBox(page: Page, id: string): Promise<Box> {
  return page.evaluate((taskId) => {
    const field = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)
    const line = field?.closest<HTMLElement>('.task-line')
    if (!line) throw new Error(`Missing task row ${taskId}`)
    const rect = line.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
  }, id)
}

// How far a box sits outside the area. Zero means it is fully visible with air.
export function overflow(box: Box, area: Box): number {
  return Math.max(0, box.right - area.right, area.left - box.left, box.bottom - area.bottom, area.top - box.top)
}

export async function revealBusy(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (globalThis as MotionWindow).__branchlogReveal?.busy() ?? false,
  )
}

export async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (total) =>
      new Promise<void>((resolve) => {
        let left = total
        const step = (): void => {
          left -= 1
          if (left <= 0) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    count,
  )
}

// The reveal is done once nothing is queued and the last applied transform has
// reached the DOM.
export async function settleReveal(page: Page): Promise<void> {
  await expect.poll(() => revealBusy(page), { timeout: 5_000 }).toBe(false)
  await frames(page, 4)
}

export async function startMotionTrack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!node) throw new Error('Missing viewport')
    const store = globalThis as MotionWindow
    const stops = [{ at: performance.now(), transform: node.style.transform }]
    let last = node.style.transform
    store.__revealMotion = { sampling: true, stops }
    const step = (): void => {
      const transform = node.style.transform
      if (transform !== last) {
        last = transform
        stops.push({ at: performance.now(), transform })
      }
      if (store.__revealMotion?.sampling) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

// Every distinct viewport value since the track started, first one included.
export async function readMotionTrack(page: Page): Promise<MotionStop[]> {
  const stops = await page.evaluate(() => {
    const store = globalThis as MotionWindow
    const motion = store.__revealMotion
    if (!motion) throw new Error('Motion track is not running')
    motion.sampling = false
    return motion.stops
  })
  return stops.map((stop) => ({ at: stop.at, ...parseTransform(stop.transform) }))
}

export interface FlightCancel {
  busyBefore: boolean
  busyAfter: boolean
  panned: Viewport
  parked: Viewport
}

// One round trip so the gesture lands while the reveal is still in flight: a wheel
// or a paper drag over empty canvas, then two reads to show nothing kept moving.
export async function cancelRevealWithGesture(
  page: Page,
  point: { x: number; y: number },
  gesture: 'wheel' | 'drag',
): Promise<FlightCancel> {
  return page.evaluate(async ({ x, y, gesture }) => {
    const read = (): Viewport => {
      const node = document.querySelector<HTMLElement>('.react-flow__viewport')
      if (!node) throw new Error('Missing viewport')
      const move = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(node.style.transform)
      const zoom = Number(/scale\(\s*([-\d.]+)\s*\)/.exec(node.style.transform)?.[1])
      if (!move || !Number.isFinite(zoom)) throw new Error(node.style.transform)
      return { x: Number(move[1]), y: Number(move[2]), zoom }
    }
    const busy = () => (globalThis as { __branchlogReveal?: { busy: () => boolean } }).__branchlogReveal?.busy() ?? false
    const target = document.elementFromPoint(x, y)
    if (!target) throw new Error('No gesture target')
    const started = performance.now()
    while (!busy() && performance.now() - started < 500) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const options = { bubbles: true, cancelable: true, clientX: x, clientY: y, isPrimary: true, pointerId: 1 }
    const busyBefore = busy()
    if (gesture === 'wheel') {
      target.dispatchEvent(new WheelEvent('wheel', { ...options, deltaY: 24 }))
    } else {
      target.dispatchEvent(new PointerEvent('pointerdown', { ...options, pointerType: 'mouse', button: 0 }))
      target.dispatchEvent(new PointerEvent('pointerup', { ...options, pointerType: 'mouse', button: 0 }))
    }
    const busyAfter = busy()
    await new Promise((resolve) => setTimeout(resolve, 60))
    const panned = read()
    await new Promise((resolve) => setTimeout(resolve, 240))
    return { busyBefore, busyAfter, panned, parked: read() }
  }, { x: point.x, y: point.y, gesture })
}

export async function activeTaskId(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.activeElement instanceof HTMLElement ? (document.activeElement.dataset.taskId ?? '') : '',
  )
}

export async function mainIds(page: Page): Promise<string[]> {
  return page.locator('.task-list [data-task-text]').evaluateAll((nodes) =>
    nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.taskId ?? '') : '')),
  )
}

export async function branchIds(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node-branch [data-task-text]').evaluateAll((nodes) =>
    nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.taskId ?? '') : '')),
  )
}

export async function clickRow(page: Page, id: string): Promise<void> {
  await page.locator(`.task-list [data-task-text][data-task-id="${id}"]`).click()
}

export async function clickBranch(page: Page, id: string): Promise<void> {
  await page
    .locator(`.react-flow__node-branch [data-task-text][data-task-id="${id}"]`)
    .click({ position: { x: 24, y: 12 } })
}

// A point on the paper with nothing on it, so a drag there pans instead of grabbing a node.
export async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) return null
    const rect = pane.getBoundingClientRect()
    for (let x = rect.left + 20; x < rect.right - 20; x += 36) {
      for (let y = rect.top + 48; y < rect.bottom - 32; y += 28) {
        const hit = document.elementFromPoint(x, y)
        if (!hit) continue
        if (hit.closest('.react-flow__node, .react-flow__attribution, .theme-lab, [role="menu"], .react-flow__minimap')) {
          continue
        }
        if (hit.closest('.react-flow__pane, .react-flow__renderer')) return { x, y }
      }
    }
    return null
  })
  if (!point) throw new Error('No empty canvas point')
  return point
}

// Slides the paper the way a trackpad drag does, so a node can be pushed out of view.
export async function panPaper(page: Page, dx: number, dy: number): Promise<void> {
  const point = await emptyCanvasPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await page.mouse.move(point.x + dx * step, point.y + dy * step)
  }
  await page.mouse.up()
  await frames(page, 3)
}

export async function branchPosition(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((nodeId) => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node-branch[data-id="${CSS.escape(nodeId)}"]`)
    if (!node) throw new Error(`Missing branch node ${nodeId}`)
    const move = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(node.style.transform)
    if (!move) throw new Error(node.style.transform)
    return { x: Number(move[1]), y: Number(move[2]) }
  }, id)
}

// The flow point a branch from this row is placed at, so a sibling can be seeded to collide.
export async function branchSpot(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((taskId) => {
    const field = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)
    const dot = field?.closest('.task-line')?.querySelector<HTMLElement>('.branch-dot')
    const viewportNode = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!dot || !viewportNode) throw new Error(`Missing branch dot for ${taskId}`)
    const rect = dot.getBoundingClientRect()
    const move = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(viewportNode.style.transform)
    const zoom = Number(/scale\(\s*([-\d.]+)\s*\)/.exec(viewportNode.style.transform)?.[1])
    if (!move || !zoom) throw new Error(viewportNode.style.transform)
    const flow = document.querySelector<HTMLElement>('.react-flow')
    if (!flow) throw new Error('Missing canvas')
    const origin = flow.getBoundingClientRect()
    return {
      x: (rect.right + 36 - origin.left - Number(move[1])) / zoom,
      y: (rect.top - origin.top - Number(move[2])) / zoom,
    }
  }, id)
}
