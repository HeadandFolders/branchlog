import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier } from './launch'

const day1 = '2026-11-01T12:00:00'
const day2iso = '2026-11-02T12:00:00'
const day4iso = '2026-11-04T12:00:00'
const day1Key = '2026-11-01'
const day2Key = '2026-11-02'
const day4Key = '2026-11-04'

interface SeedTask {
  id: string
  text: string
  dateCreated: string
  parentId?: string | null
  carriedFromId?: string | null
  chainId?: string | null
  orderIndex?: number
}

interface MapRow {
  id: string
  text: string
  dateCreated: string
  x: number
  y: number
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function openMap(page: Page): Promise<void> {
  return page.keyboard.press(`${modifier}+M`)
}

function mapRoot(page: Page) {
  return page.locator('.map-canvas')
}

function nodeById(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`)
}

// The state lives on the pill the map paints, not on the React Flow wrapper around it.
function nodeStateById(page: Page, id: string) {
  return nodeById(page, id).locator('.map-node')
}

function nodeTexts(page: Page) {
  return page.locator('.map-node-text').allTextContents()
}

async function nodeRects(page: Page): Promise<Record<string, Box>> {
  return page.evaluate(() => {
    const rects: Record<string, Box> = {}
    for (const element of document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')) {
      const id = element.dataset.id ?? ''
      if (!id) continue
      const rect = element.getBoundingClientRect()
      rects[id] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    return rects
  })
}

async function flowPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((nodeId) => {
    const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
    if (!element) throw new Error(`Missing node ${nodeId}`)
    const rect = element.getBoundingClientRect()
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) throw new Error('Missing viewport')
    const transform = viewport.style.transform
    const move = /translate(?:3d)?\(\s*([-\d.]+)px,\s*([-\d.]+)px/.exec(transform)
    const zoom = Number(/scale\(\s*([-\d.]+)\s*\)/.exec(transform)?.[1])
    const flow = document.querySelector<HTMLElement>('.react-flow')
    if (!move || !flow || !Number.isFinite(zoom) || zoom === 0) throw new Error(transform)
    const flowRect = flow.getBoundingClientRect()
    return {
      x: (rect.x - flowRect.left - Number(move[1])) / zoom,
      y: (rect.y - flowRect.top - Number(move[2])) / zoom,
    }
  }, id)
  return point
}

function expectNoOverlaps(rects: Record<string, Box>): void {
  const entries = Object.entries(rects)
  const pairs: string[] = []
  for (const [firstKey, a] of entries) {
    for (const [secondKey, b] of entries) {
      if (firstKey >= secondKey) continue
      const overlapping = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      if (overlapping) pairs.push(`${firstKey} and ${secondKey}`)
    }
  }
  expect(pairs).toEqual([])
}

// A token value resolved the way the page paints it, so hex and rgb() compare honestly.
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    const probe = document.createElement('span')
    probe.style.color = raw
    probe.style.position = 'absolute'
    probe.style.opacity = '0'
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, token)
}

interface EdgePaint {
  stroke: string
  dash: string
  markerId: string
  markerWidth: number
  markerFill: string
}

function edgePaint(page: Page, kind: 'branch' | 'carry'): Promise<EdgePaint[]> {
  return page
    .locator(`.react-flow__edge.map-edge-${kind}`)
    .locator('xpath=.//path[@marker-end]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const path = element as SVGPathElement
        const style = getComputedStyle(path)
        const reference = path.getAttribute('marker-end') ?? ''
        const markerId = /^url\(['"]?#(.+?)['"]?\)$/.exec(reference)?.[1] ?? ''
        const marker = markerId === '' ? null : document.getElementById(markerId)
        if (!marker) throw new Error(`Arrowhead "${reference}" points at nothing`)
        const head = marker.querySelector('polyline, path')
        return {
          stroke: style.stroke,
          dash: style.strokeDasharray,
          markerId,
          markerWidth: Number(marker.getAttribute('markerWidth') ?? 0),
          markerFill: head ? getComputedStyle(head).fill : '',
        }
      }),
    )
}

async function activeNodeId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement
    return element instanceof HTMLElement ? (element.dataset.id ?? '') : ''
  })
}

async function activeTaskId(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.activeElement instanceof HTMLElement ? (document.activeElement.dataset.taskId ?? '') : '',
  )
}

async function focusNode(page: Page, id: string): Promise<void> {
  await page.evaluate((nodeId) => {
    const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
    if (!element) throw new Error(`Missing node ${nodeId}`)
    element.focus()
  }, id)
}

async function dragBox(page: Page, from: Box, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const steps = 12
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + from.width / 2 + (dx * step) / steps,
      from.y + from.height / 2 + (dy * step) / steps,
    )
  }
  await page.mouse.up()
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

function seedDb(userData: string, run: (db: Database.Database) => void): void {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  run(db)
  db.close()
}

async function seedNotebook(app: ElectronApplication, userData: string): Promise<void> {
  await closeApp(app, userData, true)
  seedDb(userData, (db) => {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('autoCarry', '0')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run()
    const insert = db.prepare(
      `INSERT INTO tasks (id, text, dateCreated, parentId, carriedFromId, chainId, orderIndex)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    // Milk is one chain carried over three days; Eggs branches from it on day 2, Bread from Eggs on day 4.
    const seeds: SeedTask[] = [
      { id: 'milk-d1', text: 'Milk', dateCreated: day1Key },
      { id: 'milk-d2', text: 'Milk', dateCreated: day2Key, carriedFromId: 'milk-d1', chainId: 'milk-d1' },
      { id: 'milk-d4', text: 'Milk', dateCreated: day4Key, carriedFromId: 'milk-d2', chainId: 'milk-d1' },
      { id: 'eggs', text: 'Eggs', dateCreated: day2Key, parentId: 'milk-d1', orderIndex: 1 },
      { id: 'bread', text: 'Bread', dateCreated: day4Key, parentId: 'eggs', orderIndex: 1 },
    ]
    for (const seed of seeds) {
      insert.run(
        seed.id,
        seed.text,
        seed.dateCreated,
        seed.parentId ?? null,
        seed.carriedFromId ?? null,
        seed.chainId ?? '',
        seed.orderIndex ?? 0,
      )
    }
  })
}

function savedMapPositions(userData: string): MapRow[] {
  const rows: MapRow[] = []
  seedDb(userData, (db) => {
    const found = db
      .prepare(
        `SELECT t.id, t.text, t.dateCreated, mp.x, mp.y
         FROM mapPositions mp JOIN tasks t ON t.id = mp.taskId
         ORDER BY t.dateCreated, t.orderIndex`,
      )
      .all() as MapRow[]
    rows.push(...found)
  })
  return rows
}

function savedX(userData: string, taskId: string): number | null {
  const row = savedMapPositions(userData).find((entry) => entry.id === taskId)
  return row ? Math.round(row.x) : null
}

function settingValue(userData: string, key: string): string | null {
  let value: string | null = null
  seedDb(userData, (db) => {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined
    value = row?.value ?? null
  })
  return value
}

function savedChainColumn(userData: string, column: 'dateCompleted' | 'droppedAt'): (string | null)[] {
  const rows: { value: string | null }[] = []
  seedDb(userData, (db) => {
    const found = db
      .prepare(
        `SELECT ${column} AS value FROM tasks
         WHERE chainId = 'milk-d1' ORDER BY dateCreated`,
      )
      .all() as { value: string | null }[]
    rows.push(...found)
  })
  return rows.map((row) => row.value)
}

function heading(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

function taskRow(page: Page, text: string) {
  return page.locator('[data-task-text]', { hasText: new RegExp(`^${text}$`) }).locator('xpath=../..')
}

async function restartOnDay4(app: ElectronApplication, userData: string) {
  await closeApp(app, userData, true)
  return launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
}

test('the Concept Map opens from the menu, the shortcut and the toolbar, and closes back', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day4iso } })
  const { app, page, userData } = opened
  try {
    const menu = await app.evaluate(({ Menu }) => {
      const go = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Go')
      const item = go?.submenu?.items.find((entry) => entry.label === 'Concept Map')
      return { enabled: item?.enabled ?? false, accelerator: item?.accelerator ?? '' }
    })
    expect(menu.enabled).toBe(true)
    expect(menu.accelerator).toBe('CmdOrCtrl+M')

    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: /Concept Map/ }).click()
    await expect(mapRoot(page)).toBeVisible()
    await expect(page.getByRole('toolbar', { name: 'Concept map' })).toBeVisible()

    await page.getByRole('button', { name: 'Back' }).click()
    await expect(mapRoot(page)).toHaveCount(0)

    await openMap(page)
    await expect(mapRoot(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(heading(page)).toHaveText('Today')

    await openMap(page)
    await expect(mapRoot(page)).toBeVisible()
    await openMap(page)
    await expect(mapRoot(page)).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
  }
})

test('a fresh notebook shows a calm empty map with nothing to drag or arrange', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day4iso } })
  const { app, page, userData } = opened
  try {
    await openMap(page)
    await expect(page.locator('.map-note-title')).toHaveText('Nothing to map yet.')
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Re-arrange' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Fit' })).toBeDisabled()
    await expect(page.getByRole('note', { name: 'Map legend' })).toBeVisible()
  } finally {
    await closeApp(app, userData)
  }
})

test('the legend collapses to a chip and comes back', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day4iso } })
  const { app, page, userData } = opened
  try {
    await openMap(page)
    const legend = page.getByRole('note', { name: 'Map legend' })
    await expect(legend.getByText('Branched from')).toBeVisible()
    await expect(legend.getByText('Same task, carried to another day')).toBeVisible()
    await legend.getByRole('button', { name: 'Collapse legend' }).click()
    await expect(legend).toHaveCount(0)
    const chip = page.getByRole('button', { name: 'Legend', exact: true })
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
    await chip.click()
    await expect(legend.getByText('Branched from')).toBeVisible()
  } finally {
    await closeApp(app, userData)
  }
})

test('every task and both link kinds are drawn, each with its own arrow and color', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    await expect(page.locator('.react-flow__node')).toHaveCount(3)
    expect((await nodeTexts(page)).sort()).toEqual(['Bread', 'Eggs', 'Milk'])
    await expect(nodeStateById(page, 'milk-d1')).toHaveAttribute('data-state', 'open')
    await expect(nodeStateById(page, 'eggs')).toHaveAttribute('data-state', 'open')

    // A collapsed chain keeps its carry inside the badge, so only branch links are drawn yet.
    await expect(page.locator('.react-flow__edge.map-edge-branch')).toHaveCount(2)
    await expect(page.locator('.react-flow__edge.map-edge-carry')).toHaveCount(0)

    await nodeById(page, 'milk-d1').getByRole('button', { name: /Carried across 3 days/ }).click()
    await expect(page.locator('.react-flow__node')).toHaveCount(5)
    await expect(page.locator('.react-flow__edge.map-edge-branch')).toHaveCount(2)
    await expect(page.locator('.react-flow__edge.map-edge-carry')).toHaveCount(2)

    const edgeColor = await tokenColor(page, '--edge')
    const carryColor = await tokenColor(page, '--carried')
    const branches = await edgePaint(page, 'branch')
    const carried = await edgePaint(page, 'carry')
    expect(branches).toHaveLength(2)
    expect(carried).toHaveLength(2)
    for (const edge of branches) {
      expect(edge.stroke).toBe(edgeColor)
      expect(edge.markerFill).toBe(edgeColor)
      expect(edge.dash).toBe('none')
    }
    for (const edge of carried) {
      expect(edge.stroke).toBe(carryColor)
      expect(edge.markerFill).toBe(carryColor)
      expect(edge.dash).toMatch(/4/)
    }
    // The two kinds differ by shape as well as color: the carry arrowhead is the smaller one.
    expect(Math.min(...branches.map((edge) => edge.markerWidth))).toBeGreaterThan(
      Math.max(...carried.map((edge) => edge.markerWidth)),
    )
    expect(new Set([...branches, ...carried].map((edge) => edge.markerId)).size).toBe(2)

    expect((await page.locator('.map-date-label').allTextContents()).sort()).toEqual([
      'Nov 1',
      'Nov 2',
      'Nov 4',
    ])
  } finally {
    await closeApp(app, userData)
  }
})

test('a collapsed chain badges its day count and expands into date columns', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    const milk = nodeById(page, 'milk-d1')
    await expect(milk.locator('.map-node-date')).toHaveText('Nov 1 – Nov 4')
    const badge = milk.getByRole('button', { name: /Carried across 3 days/ })
    await expect(badge).toHaveText('3 days')
    await expect(badge).toHaveAttribute('aria-expanded', 'false')

    await badge.click()
    await expect(nodeById(page, 'milk-d2')).toBeVisible()
    await expect(nodeById(page, 'milk-d4')).toBeVisible()
    await expect(page.locator('.react-flow__node')).toHaveCount(5)
    expectNoOverlaps(await nodeRects(page))
    await expect(page.locator('.react-flow__edge.map-edge-carry')).toHaveCount(2)

    const collapse = nodeById(page, 'milk-d4').getByRole('button', { name: /Carried across 3 days/ })
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await collapse.click()
    await expect(page.locator('.react-flow__node')).toHaveCount(3)
    await expect(nodeById(page, 'milk-d1')).toBeVisible()
  } finally {
    await closeApp(app, userData)
  }
})

test('dragging saves one position per drag, keeps it across a restart, and undoes in one step', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    const start = await nodeRects(page)
    const eggs = start['eggs'] as Box
    await page.mouse.move(eggs.x + eggs.width / 2, eggs.y + eggs.height / 2)
    await page.mouse.down()
    await page.mouse.move(eggs.x + eggs.width / 2 + 60, eggs.y + eggs.height / 2 + 40, { steps: 6 })
    expect(savedMapPositions(userData), 'a drag writes nothing while the pointer is down').toEqual([])
    await page.mouse.up()

    const afterFirst = await flowPoint(page, 'eggs')
    const movedEggs = (await nodeRects(page))['eggs'] as Box
    expect(movedEggs.x - eggs.x).toBeGreaterThan(20)
    expect(movedEggs.y - eggs.y).toBeGreaterThan(15)
    await expect
      .poll(() => {
        const rows = savedMapPositions(userData)
        return rows.map((row) => [row.text, Math.round(row.x), Math.round(row.y)])
      })
      .toEqual([['Eggs', Math.round(afterFirst.x), Math.round(afterFirst.y)]])

    await dragBox(page, (await nodeRects(page))['eggs'] as Box, 20, 20)
    const afterSecond = await flowPoint(page, 'eggs')
    await expect
      .poll(() => savedMapPositions(userData).map((row) => Math.round(row.x)))
      .toEqual([Math.round(afterSecond.x)])
    expect(savedMapPositions(userData), 'the second drag updates the same row').toHaveLength(1)

    // One Ctrl+Z steps back over the second drag, on the canvas and in the database.
    await page.keyboard.press(`${modifier}+Z`)
    await expect
      .poll(async () => Math.round((await flowPoint(page, 'eggs')).x))
      .toBe(Math.round(afterFirst.x))
    await expect.poll(() => savedX(userData, 'eggs')).toBe(Math.round(afterFirst.x))

    // The undone position is what a restart brings back.
    const again = await restartOnDay4(app, userData)
    app = again.app
    page = again.page
    await openMap(page)
    const kept = await flowPoint(page, 'eggs')
    expect(Math.abs(kept.x - afterFirst.x)).toBeLessThan(6)
    expect(Math.abs(kept.y - afterFirst.y)).toBeLessThan(6)
  } finally {
    await closeApp(app, userData)
  }
})

test('re-arrange moves placed nodes back into columns and undoes as one step', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    const laid = { eggs: await flowPoint(page, 'eggs'), bread: await flowPoint(page, 'bread') }
    await dragBox(page, (await nodeRects(page))['eggs'] as Box, 150, 90)
    await dragBox(page, (await nodeRects(page))['bread'] as Box, -60, 120)
    const dragged = { eggs: await flowPoint(page, 'eggs'), bread: await flowPoint(page, 'bread') }
    expect(dragged.eggs.x - laid.eggs.x).toBeGreaterThan(30)
    await expect.poll(() => savedX(userData, 'eggs')).toBe(Math.round(dragged.eggs.x))
    await expect.poll(() => savedX(userData, 'bread')).toBe(Math.round(dragged.bread.x))

    await page.getByRole('button', { name: 'Re-arrange' }).click()
    await expect
      .poll(async () => Math.round((await flowPoint(page, 'eggs')).x))
      .toBe(Math.round(laid.eggs.x))
    await expect
      .poll(async () => Math.round((await flowPoint(page, 'bread')).x))
      .toBe(Math.round(laid.bread.x))
    await expect.poll(() => savedX(userData, 'eggs')).toBe(Math.round(laid.eggs.x))
    await expect.poll(() => savedX(userData, 'bread')).toBe(Math.round(laid.bread.x))

    // One undo step brings both placed nodes back, not just the last one touched.
    await page.keyboard.press(`${modifier}+Z`)
    await expect
      .poll(async () => Math.round((await flowPoint(page, 'eggs')).x))
      .toBe(Math.round(dragged.eggs.x))
    await expect
      .poll(async () => Math.round((await flowPoint(page, 'bread')).x))
      .toBe(Math.round(dragged.bread.x))
    await expect.poll(() => savedX(userData, 'eggs')).toBe(Math.round(dragged.eggs.x))
    await expect.poll(() => savedX(userData, 'bread')).toBe(Math.round(dragged.bread.x))
  } finally {
    await closeApp(app, userData)
  }
})

test('expanding after a drag keeps placed nodes in place and spreads copies without overlaps', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    const before = await nodeRects(page)
    await dragBox(page, before['milk-d1'] as Box, 120, 60)
    const dragged = await nodeRects(page)
    const milkFlow = await flowPoint(page, 'milk-d1')

    await nodeById(page, 'milk-d1').getByRole('button', { name: /Carried across 3 days/ }).click()
    const expanded = await nodeRects(page)
    expect(Math.abs(expanded['eggs']!.x - dragged['eggs']!.x)).toBeLessThan(2)
    expect(Math.abs(expanded['eggs']!.y - dragged['eggs']!.y)).toBeLessThan(2)
    expect(Math.abs(expanded['bread']!.x - dragged['bread']!.x)).toBeLessThan(2)
    expect(Math.abs(expanded['milk-d4']!.x - dragged['milk-d1']!.x)).toBeLessThan(2)
    expect(Math.abs(expanded['milk-d4']!.y - dragged['milk-d1']!.y)).toBeLessThan(2)
    const d1Flow = await flowPoint(page, 'milk-d1')
    const d2Flow = await flowPoint(page, 'milk-d2')
    const d4Flow = await flowPoint(page, 'milk-d4')
    expect(Math.abs(d4Flow.x - milkFlow.x)).toBeLessThan(2)
    expect(Math.abs(d4Flow.y - milkFlow.y)).toBeLessThan(2)
    // The copies the chain came from are laid out along the date columns, left to right.
    expect(d1Flow.x).toBeLessThan(d2Flow.x)
    expectNoOverlaps(expanded)
    expect(savedMapPositions(userData)).toHaveLength(1)
  } finally {
    await closeApp(app, userData)
  }
})

test('show carried copies is a setting: it persists across a restart', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    const setting = page.getByRole('switch', { name: 'Show carried copies' })
    await expect(setting).toHaveAttribute('aria-checked', 'false')
    await setting.click()
    await expect(setting).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => settingValue(userData, 'mapExpandChains')).toBe('1')
    await expect(page.locator('.react-flow__node')).toHaveCount(5)
    await expect(nodeById(page, 'milk-d4')).toBeVisible()

    const again = await restartOnDay4(app, userData)
    app = again.app
    page = again.page
    await openMap(page)
    await expect(page.getByRole('switch', { name: 'Show carried copies' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.react-flow__node')).toHaveCount(5)
    await expect(nodeById(page, 'milk-d2').getByRole('button', { name: /Carried across 3 days/ })).toHaveCount(0)

    await page.getByRole('switch', { name: 'Show carried copies' }).click()
    await expect.poll(() => settingValue(userData, 'mapExpandChains')).toBe('0')
    await expect(nodeById(page, 'milk-d1').getByRole('button', { name: /Carried across 3 days/ })).toHaveText('3 days')
  } finally {
    await closeApp(app, userData)
  }
})

test('nodes show the derived chain states: the final state collapsed, finished-later and dropped when expanded', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    const milk = nodeById(page, 'milk-d1')
    await expect(milk.locator('.map-node-date')).toHaveText('Nov 1 – Nov 4')
    await expect(nodeStateById(page, 'milk-d1')).toHaveAttribute('data-state', 'open')
    await page.getByRole('button', { name: 'Back' }).click()

    // Finishing the latest copy closes the chain, and the collapsed node shows that final state.
    await taskRow(page, 'Milk').getByRole('checkbox', { name: 'Mark task done' }).click()
    await expect.poll(() => savedChainColumn(userData, 'dateCompleted')).toEqual([null, null, day4Key])
    await openMap(page)
    await expect(nodeStateById(page, 'milk-d1')).toHaveAttribute('data-state', 'done')
    await page.getByRole('button', { name: 'Back' }).click()

    // Letting one earlier copy go is read backward without rewriting that copy.
    await jumpTo(app, page, day2iso)
    await taskRow(page, 'Milk').hover()
    await taskRow(page, 'Milk').getByRole('button', { name: "Let go (won't carry over)" }).click()
    await expect.poll(() => savedChainColumn(userData, 'droppedAt')).toEqual([null, day2Key, null])

    await openMap(page)
    await page.getByRole('switch', { name: 'Show carried copies' }).click()
    const first = nodeStateById(page, 'milk-d1')
    await expect(first).toHaveAttribute('data-state', 'finished-later')
    await expect(first.locator('.map-node-mark[data-mark="finished-later"]')).toHaveAttribute(
      'title',
      'Finished Nov 4',
    )
    const middle = nodeStateById(page, 'milk-d2')
    await expect(middle).toHaveAttribute('data-state', 'dropped')
    await expect(middle.locator('.map-node-mark[data-mark="dropped"]')).toHaveAttribute('title', 'Let go on Nov 2')
    expect(
      await middle.locator('.map-node-text').evaluate((element) =>
        getComputedStyle(element).getPropertyValue('text-decoration-line'),
      ),
    ).toBe('line-through')
    expect(await middle.locator('.map-node-text').evaluate((element) => getComputedStyle(element).color)).toBe(
      await tokenColor(page, '--dropped'),
    )
    await expect(nodeStateById(page, 'milk-d4')).toHaveAttribute('data-state', 'done')
  } finally {
    await closeApp(app, userData)
  }
})

test('clicking a node opens the day it belongs to, and the chain opens its latest copy', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    const eggs = (await nodeRects(page))['eggs'] as Box
    await page.mouse.click(eggs.x + eggs.width / 2, eggs.y + eggs.height / 2)
    await expect(heading(page)).toHaveText('Tuesday, November 2')
    await expect.poll(() => activeTaskId(page)).toBe('eggs')
    await expect(page.locator('[data-task-text]').first()).toHaveText('Milk')

    await openMap(page)
    const milk = (await nodeRects(page))['milk-d1'] as Box
    await page.mouse.click(milk.x + milk.width / 2, milk.y + milk.height / 2)
    await expect(heading(page)).toHaveText('Wednesday, November 4')
    await expect.poll(() => activeTaskId(page)).toBe('milk-d4')
  } finally {
    await closeApp(app, userData)
  }
})

test('the map pans with the pane, zooms with ctrl+wheel, and never zooms the window', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    await expect(page.locator('.react-flow__node')).toHaveCount(3)
    const point = await emptyPoint(page)
    const before = await viewport(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x - 140, point.y - 80, { steps: 8 })
    await page.mouse.up()
    const panned = await viewport(page)
    expect(panned.x).toBeLessThan(before.x - 40)
    expect(panned.zoom).toBeCloseTo(before.zoom, 2)

    await page.mouse.wheel(0, -240)
    const plain = await viewport(page)
    expect(plain.zoom).toBeCloseTo(panned.zoom, 2)

    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -240)
    await page.keyboard.up('Control')
    const zoomed = await viewport(page)
    expect(zoomed.zoom).toBeGreaterThan(panned.zoom + 0.05)

    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 0)
    const factor = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0,
    )
    expect(scale).toBe(1)
    expect(factor).toBe(1)

    await page.keyboard.down('Control')
    for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, -480)
    await page.keyboard.up('Control')
    expect((await viewport(page)).zoom).toBeLessThanOrEqual(2.001)
  } finally {
    await closeApp(app, userData)
  }
})

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

async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) return null
    const rect = pane.getBoundingClientRect()
    for (let y = rect.top + 48; y < rect.bottom - 32; y += 28) {
      for (let x = rect.left + 20; x < rect.right - 20; x += 36) {
        const el = document.elementFromPoint(x, y)
        if (!el) continue
        if (
          el.closest(
            '.react-flow__node, .react-flow__attribution, .map-toolbar, .map-legend, .map-minimap, .map-controls, .map-note',
          )
        ) {
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

test('Ctrl+K finds a task on the map, and arrows and Enter move around', async () => {
  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day1 } })
  let app = opened.app
  let page = opened.page
  let userData = opened.userData
  try {
    await seedNotebook(app, userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page
    userData = restarted.userData

    await openMap(page)
    await expect(page.locator('.react-flow__node')).toHaveCount(3)
    await page.keyboard.press(`${modifier}+K`)
    const dialog = page.getByRole('dialog', { name: 'Find a task on the map' })
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(5)
    await page.getByRole('textbox', { name: 'Search tasks on the map' }).fill('bread')
    await expect(page.getByRole('option', { name: /^Bread/ })).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => activeNodeId(page)).toBe('bread')

    // Left and right follow the links.
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => activeNodeId(page)).toBe('eggs')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => activeNodeId(page)).toBe('milk-d1')
    await page.keyboard.press('Enter')
    await expect(heading(page)).toHaveText('Wednesday, November 4')
    await expect.poll(() => activeTaskId(page)).toBe('milk-d4')

    await openMap(page)
    await page.getByRole('switch', { name: 'Show carried copies' }).click()
    await expect(page.locator('.react-flow__node')).toHaveCount(5)
    await page.getByRole('button', { name: 'Re-arrange' }).click()
    await page.getByRole('button', { name: 'Fit' }).click()
    const laid = await nodeRects(page)
    const top = laid['eggs']!.y <= laid['milk-d2']!.y ? 'eggs' : 'milk-d2'
    const below = top === 'eggs' ? 'milk-d2' : 'eggs'

    // Up and down walk the same date column.
    await focusNode(page, top)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => activeNodeId(page)).toBe(below)
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => activeNodeId(page)).toBe(top)

    // A branch link wins over a carry link leaving the same node, and a copy follows its carry.
    await focusNode(page, 'milk-d1')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => activeNodeId(page)).toBe('eggs')
    await focusNode(page, 'milk-d2')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => activeNodeId(page)).toBe('milk-d4')
  } finally {
    await closeApp(app, userData)
  }
})
