import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type Page } from '@playwright/test'
import { buildMapGraph } from '../src/shared/map-graph'
import { layoutMapGraph, mapNodeSizes } from '../src/shared/map-layout'
import type { MapTask, TaskChainState } from '../src/shared/types'
import { closeApp, launchApp, modifier } from './launch'

const day4iso = '2026-11-04T12:00:00'

const PLAIN_TASKS = 2000
const BRANCH_TASKS = 300

// Budgets are generous ceilings. The measured numbers print below each test;
// tighten them only against the same machine and build.
const LOAD_BUDGET_MS = 400
const GRAPH_BUILD_BUDGET_MS = 250
// The 2,301-node dagre pass measured 310.0ms on this machine on 2026-11-09 (printed by the last
// test). The ceiling leaves room for a cold run without hiding a step change.
const LAYOUT_BUDGET_MS = 700
const OPEN_BUDGET_MS = 5000
const PAN_FLOOR_FPS = 5
const FIRST_PAINT_MARGIN_MS = 1500

// The arrowheads come from React Flow's own marker set now, so the last marker is an edge class
// name that only the map builds.
const MAP_MARKERS = ['dagre', 'graphlib', 'buildMapGraph', 'layoutMapGraph', 'map-edge-carry']

interface PaintBand {
  runs: number
  min: number
  median: number
  max: number
}

async function readPaintBaseline(): Promise<{ shellVisiblePerfMs: PaintBand; fcpStartTimeMs: PaintBand }> {
  const file = path.join(process.cwd(), 'tests', 'fixtures', 'first-paint-baseline.json')
  const text = await readFile(file, 'utf8')
  const parsed = JSON.parse(text) as { shellVisiblePerfMs: PaintBand; fcpStartTimeMs: PaintBand }
  return { shellVisiblePerfMs: parsed.shellVisiblePerfMs, fcpStartTimeMs: parsed.fcpStartTimeMs }
}

function assetsDir(): string {
  return path.join(process.cwd(), 'out', 'renderer', 'assets')
}

async function chunkFiles(): Promise<{ index: string[]; concept: string[] }> {
  const names = await readdir(assetsDir())
  return {
    index: names.filter((name) => /^index-.*\.js$/.test(name)),
    concept: names.filter((name) => /^ConceptMap-.*\.js$/.test(name)),
  }
}

function seedPlainNotebook(userData: string): void {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 5000')
  const insert = db.prepare(
    `INSERT INTO tasks (id, text, dateCreated, parentId, carriedFromId, chainId, orderIndex)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const day = (offset: number): string =>
    new Date(Date.UTC(2026, 8, 7) + offset * 86_400_000).toISOString().slice(0, 10)
  db.transaction(() => {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('autoCarry', '0')`).run()
    insert.run('milk-1', 'Milk', day(0), null, null, '', 0)
    insert.run('milk-2', 'Milk', day(1), null, 'milk-1', 'milk-1', 0)
    insert.run('milk-3', 'Milk', day(2), null, 'milk-2', 'milk-1', 0)
    for (let index = 0; index < PLAIN_TASKS; index += 1) {
      insert.run(`p-${index}`, `Plain task ${index}`, day(index % 60), null, null, '', index % 40)
    }
    for (let index = 0; index < BRANCH_TASKS; index += 1) {
      const parent = `p-${(index * 7) % PLAIN_TASKS}`
      insert.run(`b-${index}`, `Branch child ${index}`, day((index * 3) % 60), parent, null, '', 30)
    }
  })()
  db.close()
}

function savedRows(userData: string): { count: number; forTask: (id: string) => { x: number; y: number } | null } {
  const open = (): Database.Database => {
    const db = new Database(path.join(userData, 'branchlog.sqlite'), { readonly: true })
    db.pragma('busy_timeout = 3000')
    return db
  }
  return {
    get count(): number {
      const db = open()
      try {
        return (db.prepare(`SELECT COUNT(*) AS n FROM mapPositions`).get() as { n: number }).n
      } finally {
        db.close()
      }
    },
    forTask(id: string) {
      const db = open()
      try {
        const row = db.prepare(`SELECT x, y FROM mapPositions WHERE taskId = ?`).get(id) as
          | { x: number; y: number }
          | undefined
        return row ?? null
      } finally {
        db.close()
      }
    },
  }
}

async function startFrameRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: number[] = []
    ;(globalThis as { __panFrames?: number[] }).__panFrames = frames
    const tick = (time: number): void => {
      frames.push(time)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function frameSample(page: Page): Promise<{ frames: number; fps: number }> {
  return page.evaluate(() => {
    const recorded = (globalThis as { __panFrames?: number[] }).__panFrames
    if (!recorded) return { frames: 0, fps: 0 }
    // The recorder closes over this exact array, so the sample has to be cleared in place.
    // Replacing the global would strand the second sample on an array nothing writes to.
    const recent = recorded.slice(-120)
    recorded.length = 0
    if (recent.length < 2) return { frames: recent.length, fps: 0 }
    const first = recent[0] ?? 0
    const last = recent[recent.length - 1] ?? 0
    const span = last - first
    return { frames: recent.length, fps: span > 0 ? ((recent.length - 1) / span) * 1000 : 0 }
  })
}

async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')
    if (!pane) return null
    const rect = pane.getBoundingClientRect()
    for (let y = rect.top + 64; y < rect.bottom - 32; y += 32) {
      for (let x = rect.left + 24; x < rect.right - 24; x += 36) {
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

async function measureDone(logFile: string): Promise<boolean> {
  try {
    return (await readFile(logFile, 'utf8')).includes('"label":"measure-done"')
  } catch {
    // The app has not written its first mark yet; the poll below keeps waiting and fails on timeout.
    return false
  }
}

async function mapChunksLoaded(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('ConceptMap')),
  )
}

test('the map lives in its own lazy chunk and never loads at startup', async () => {
  const files = await chunkFiles()
  expect(files.concept.length).toBeGreaterThan(0)
  expect(files.index.length).toBeGreaterThan(0)

  const indexSource = await Promise.all(
    files.index.map(async (name) => readFile(path.join(assetsDir(), name), 'utf8')),
  )
  const conceptSource = await readFile(path.join(assetsDir(), files.concept[0] as string), 'utf8')
  const mainBundle = indexSource.join('\n')

  for (const marker of MAP_MARKERS) {
    expect(mainBundle, `the main chunk must not contain ${marker}`).not.toContain(marker)
    expect(conceptSource, `the map chunk must contain ${marker}`).toContain(marker)
  }
  // The main chunk still has to know which file to fetch, so the lazy import reference is the one
  // marker it is allowed to carry.
  expect(mainBundle).toContain('ConceptMap-')

  const opened = await launchApp('', { env: { BRANCHLOG_NOW: day4iso } })
  const { app, page, userData } = opened
  try {
    await page.locator('[data-task-text], [aria-label="New task"]').first().waitFor()
    await page.waitForTimeout(300)
    expect(await mapChunksLoaded(page)).toEqual([])

    await page.keyboard.press(`${modifier}+M`)
    // The daily canvas is React Flow too, so the probe has to name the map: this div only exists
    // once the lazy chunk has been fetched and executed.
    await expect(page.locator('.map-canvas')).toBeVisible({ timeout: 10_000 })
    expect((await mapChunksLoaded(page)).length).toBeGreaterThan(0)
  } finally {
    await closeApp(app, userData)
  }
})

test('first paint costs nothing for the map', async () => {
  test.setTimeout(120_000)
  const dir = await mkdtemp(path.join(tmpdir(), 'branchlog-fcp-'))
  const logFile = path.join(dir, 'first-paint.log')
  const opened = await launchApp('', {
    env: { BRANCHLOG_NOW: day4iso, BRANCHLOG_MEASURE: '1', BRANCHLOG_MEASURE_LOG: logFile },
  })
  const { app, userData } = opened
  let text = ''
  try {
    // Measuring mode makes the app quit itself once the probes finish, so the log file is the artifact.
    await expect.poll(() => measureDone(logFile), { timeout: 60_000 }).toBe(true)
    // Read it here: the temp folder is removed in the finally block.
    text = await readFile(logFile, 'utf8')
  } finally {
    await closeApp(app, userData)
    await rm(dir, { recursive: true, force: true })
  }

  const marks = text
    .split('\n')
    .filter((line) => line.startsWith('TEMP_MARK '))
    .map((line) => JSON.parse(line.slice('TEMP_MARK '.length)) as Record<string, number | string>)
  const first = (label: string): Record<string, number | string> | undefined =>
    marks.find((mark) => mark.label === label)
  const numberIn = (mark: Record<string, number | string> | undefined, key: string): number | null => {
    const value = mark?.[key]
    return typeof value === 'number' ? value : null
  }

  const fcp = numberIn(first('fcp'), 'startTime')
  const shell = numberIn(first('shell-visible'), 'perf')
  const resourceNames = marks
    .filter((mark) => mark.label === 'resource-slow')
    .map((mark) => String(mark.name ?? ''))
  const totals = first('resources')
  const baseline = await readPaintBaseline()

  console.log(
    `first paint without a map visit: fcp=${fcp}ms shell-visible=${shell}ms ` +
      `resources=${JSON.stringify(totals)} (recorded band fcp ${baseline.fcpStartTimeMs.min}–` +
      `${baseline.fcpStartTimeMs.max}ms over ${baseline.fcpStartTimeMs.runs} runs)`,
  )

  expect(fcp).not.toBeNull()
  expect(shell).not.toBeNull()
  // Startup payload must hold no map bytes at all.
  expect(resourceNames.filter((name) => name.includes('ConceptMap'))).toEqual([])
  // The machine band is wide (min to max above), so this only catches a step change in regime,
  // not a few hundred ms. The chunk assertions are the real guard.
  expect(fcp as number).toBeLessThanOrEqual(baseline.fcpStartTimeMs.max + FIRST_PAINT_MARGIN_MS)
  expect(shell as number).toBeLessThanOrEqual(baseline.shellVisiblePerfMs.max + FIRST_PAINT_MARGIN_MS)
})

test('the map opens, pans and drags on a 2,300-task notebook', async () => {
  test.setTimeout(240_000)
  const first = await launchApp('', { env: { BRANCHLOG_NOW: day4iso } })
  const userData = first.userData
  let app = first.app
  let page = first.page
  try {
    await closeApp(app, userData, true)
    seedPlainNotebook(userData)
    const restarted = await launchApp(userData, { env: { BRANCHLOG_NOW: day4iso } })
    app = restarted.app
    page = restarted.page

    const started = Date.now()
    await page.keyboard.press(`${modifier}+M`)
    // Not ".react-flow__node": the daily canvas is React Flow as well, and that would measure nothing.
    await page.waitForFunction(
      () => document.querySelector('.map-canvas .react-flow__node-mapTask') !== null,
      undefined,
      { timeout: 30_000 },
    )
    const openMs = Math.round(Date.now() - started)
    const rows = PLAIN_TASKS + BRANCH_TASKS + 3
    console.log(`map open for ${rows} rows: ${openMs}ms (budget ${OPEN_BUDGET_MS}ms)`)
    expect(openMs).toBeLessThanOrEqual(OPEN_BUDGET_MS)

    // Chain collapse and link counts are asserted in the pure pass below and in map.spec.ts;
    // at this scale only a slice of the graph is rendered, so DOM counts would prove nothing here.
    const nodes = await page.locator('.react-flow__node').count()
    const edges = await page.locator('.react-flow__edge').count()
    console.log(`rendered after open: ${nodes} nodes, ${edges} edges (only visible elements)`)
    expect(nodes).toBeGreaterThan(0)

    const main = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('Missing window')
      return win.webContents
        .executeJavaScript(
          `(async () => {
            const started = performance.now()
            await window.branchlog.map.load()
            return Math.round((performance.now() - started) * 10) / 10
          })()`,
        )
        .then((value: unknown) => Number(value))
    })
    console.log(`map:load round trip (query + serialize + IPC): ${main}ms (budget ${LOAD_BUDGET_MS}ms)`)
    expect(main).toBeLessThanOrEqual(LOAD_BUDGET_MS)

    const positions = savedRows(userData)
    const rowsBeforePan = positions.count

    await startFrameRecorder(page)
    const point = await emptyPoint(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(point.x - step * 18, point.y - step * 7)
    }
    await page.mouse.up()
    const pan = await frameSample(page)
    console.log(`pan over ${pan.frames} frames: ${Math.round(pan.fps)} fps (floor ${PAN_FLOOR_FPS})`)
    expect(pan.fps).toBeGreaterThanOrEqual(PAN_FLOOR_FPS)
    expect(positions.count, 'panning must not write positions').toBe(rowsBeforePan)

    const target = await page.evaluate(() => {
      // A plain task, never the collapsed milk chain: a chain node saves under its latest copy's id.
      const element = document.querySelector<HTMLElement>('.map-canvas .react-flow__node[data-id^="p-"]')
      if (!element) throw new Error('No node to drag')
      const rect = element.getBoundingClientRect()
      return { id: element.dataset.id ?? '', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    const rowsBeforeDrag = positions.count
    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    let rowsDuringDrag = rowsBeforeDrag
    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(target.x + step * 6, target.y + step * 4)
      if (step === 10) rowsDuringDrag = positions.count
    }
    await page.mouse.up()
    const dragged = await frameSample(page)
    console.log(`drag over ${dragged.frames} frames: ${Math.round(dragged.fps)} fps`)
    expect(dragged.fps).toBeGreaterThanOrEqual(PAN_FLOOR_FPS)
    expect(rowsDuringDrag, 'a drag must not write per frame').toBe(rowsBeforeDrag)

    await expect
      .poll(() => positions.forTask(target.id) !== null, { timeout: 10_000 })
      .toBe(true)
    const saved = positions.forTask(target.id) as { x: number; y: number }
    expect(positions.count, 'one drag saves one row').toBe(rowsBeforeDrag + 1)
    console.log(`drag saved position (${saved.x.toFixed(1)}, ${saved.y.toFixed(1)}) for ${target.id}`)
  } finally {
    await closeApp(app, userData)
  }
})

function mapTask(id: string, dateCreated: string, extra: Partial<MapTask> = {}): MapTask {
  return {
    id,
    text: id,
    dateCreated,
    dateCompleted: null,
    droppedAt: null,
    parentId: null,
    carriedFromId: null,
    chainId: id,
    orderIndex: 0,
    mapX: null,
    mapY: null,
    ...extra,
  }
}

test('graph and layout stay fast on a 2,300-task notebook', async () => {
  const days = 60
  const tasks: MapTask[] = []
  const states: TaskChainState[] = []
  const openState = (id: string): TaskChainState => ({
    id,
    state: 'open',
    date: null,
    copyId: null,
    copyDate: null,
    carriedFromDay: null,
    carriedDays: 0,
  })
  const add = (task: MapTask): void => {
    tasks.push(task)
    states.push(openState(task.id))
  }
  const day = (offset: number): string =>
    new Date(Date.UTC(2026, 8, 7) + offset * 86_400_000).toISOString().slice(0, 10)
  for (let index = 0; index < PLAIN_TASKS; index += 1) {
    add(mapTask(`p-${index}`, day(index % days), { text: `Plain task ${index}`, orderIndex: index % 40 }))
  }
  for (let index = 0; index < BRANCH_TASKS; index += 1) {
    add(
      mapTask(`b-${index}`, day((index * 3) % days), {
        text: `Branch child ${index}`,
        parentId: `p-${(index * 7) % PLAIN_TASKS}`,
        orderIndex: 30,
      }),
    )
  }
  add(mapTask('milk-1', day(0), { text: 'Milk' }))
  add(mapTask('milk-2', day(1), { text: 'Milk', carriedFromId: 'milk-1', chainId: 'milk-1' }))
  add(mapTask('milk-3', day(2), { text: 'Milk', carriedFromId: 'milk-2', chainId: 'milk-1' }))

  const started = performance.now()
  const graph = buildMapGraph(tasks, states, { expandAll: false, expanded: new Set() })
  const buildMs = performance.now() - started
  const layoutStart = performance.now()
  const points = layoutMapGraph(graph, mapNodeSizes(graph))
  const layoutMs = performance.now() - layoutStart

  // 2,300 own-chain rows plus one collapsed milk chain.
  expect(graph.nodes).toHaveLength(PLAIN_TASKS + BRANCH_TASKS + 1)
  expect(graph.links).toHaveLength(BRANCH_TASKS)
  expect(points.size).toBe(graph.nodes.length)
  console.log(
    `buildMapGraph(${tasks.length} rows): ${buildMs.toFixed(1)}ms (budget ${GRAPH_BUILD_BUDGET_MS}ms), ` +
      `layoutMapGraph(${graph.nodes.length} nodes): ${layoutMs.toFixed(1)}ms (budget ${LAYOUT_BUDGET_MS}ms)`,
  )
  expect(buildMs).toBeLessThanOrEqual(GRAPH_BUILD_BUDGET_MS)
  expect(layoutMs).toBeLessThanOrEqual(LAYOUT_BUDGET_MS)

  const expandStart = performance.now()
  const expandedGraph = buildMapGraph(tasks, states, { expandAll: true, expanded: new Set() })
  layoutMapGraph(expandedGraph, mapNodeSizes(expandedGraph))
  const expandMs = performance.now() - expandStart
  console.log(`full expand-all pass (${expandedGraph.nodes.length} nodes): ${expandMs.toFixed(1)}ms`)
  expect(expandMs).toBeLessThanOrEqual(GRAPH_BUILD_BUDGET_MS + LAYOUT_BUDGET_MS)
})
