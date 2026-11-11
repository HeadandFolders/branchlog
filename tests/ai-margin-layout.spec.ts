import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, initDatabase } from '../src/main/database.ts'
import { insertComment } from '../src/main/ai-store.ts'
import type { AiComment } from '../src/shared/ai-comments.ts'
import { closeApp, launchApp, modifier } from './launch'
import { startMockLmStudio } from './mock-lm-studio'
import { enableAi } from './ai-helpers'
import { mouseSelect } from './ai-chat-helpers'

const DAY = '2026-11-09'
const NOW = `${DAY}T12:00:00.000Z`
// Every seeded comment lands on this one spot, which is the shape the margin used to
// keep after a session: several notes sharing a position, painted over each other.
const SEED_X = -300
const SEED_Y = 220
const LONG_TEXT = 'What does done look like for this, and is the first step small enough to start today?'
const KEPT: [number, number][] = [[5, 9], [46, 51]]
const GAP = 16

interface LayoutWindow {
  __branchlogLayout?: { idle: () => boolean }
}

interface Seeded {
  commentId: string
  taskId: string
  taskIndex: number
  // Seeded oldest first, so the newest note on a line is the last entry pushed.
  index: number
  trimmed: boolean
}

function insertTask(db: Database.Database, text: string, order: number): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO tasks (id, text, done, dateCreated, dateCompleted, parentId, side, x, y, width, height, orderIndex, chainId)
     VALUES (?, ?, 0, ?, NULL, NULL, 'main', 0, ?, 0, 0, ?, ?)`,
  ).run(id, text, DAY, order * 40, order, id)
  return id
}

function seed(userData: string, write: (db: Database.Database, seeded: Seeded[]) => void): Seeded[] {
  const db = initDatabase(userData)
  const seeded: Seeded[] = []
  try {
    write(db, seeded)
  } finally {
    closeDatabase()
  }
  return seeded
}

function push(seeded: Seeded[], db: Database.Database, taskId: string, taskIndex: number, keptRanges: string, slot: number): Seeded {
  const trimmed = keptRanges !== '[]'
  const item: AiComment = {
    // Seeded ids count up, so the column order is the same in every run: two notes
    // sharing a spot and holding the same rank on their line break by id, and a snapshot
    // needs to be reproducible.
    id: `00000000-0000-4000-8000-${String(slot).padStart(12, '0')}`,
    taskId,
    side: 'left',
    type: 'question',
    text: LONG_TEXT,
    status: 'open',
    keptRanges,
    x: SEED_X,
    y: SEED_Y,
    createdAt: `2026-11-09T10:00:${String(seeded.length).padStart(2, '0')}.000Z`,
    replies: [],
  }
  insertComment(item)
  const entry = { commentId: item.id, taskId, taskIndex, index: seeded.length, trimmed }
  seeded.push(entry)
  return entry
}

// Five lines with one note each, one line with three, and a trimmed note that keeps two
// phrases. The crowded line comes last so its three notes differ only by age.
function seedCrowded(userData: string): Seeded[] {
  const texts = ['write the outline', 'draft the introduction', 'cut the second half', 'pick three sources', 'ship the draft', 'one small step']
  return seed(userData, (db, seeded) => {
    const taskIds = texts.map((text, order) => insertTask(db, text, order))
    taskIds.forEach((taskId, order) => {
      if (order === texts.length - 1) return
      push(seeded, db, taskId, order, '[]', order + 1)
    })
    for (let copy = 0; copy < 3; copy += 1) push(seeded, db, taskIds[5]!, 5, '[]', copy + 6)
    // The trimmed note is the newest on its line, so it heads the column. It takes the
    // first id slot to sit at the top, where a hover reveal is on screen to measure.
    push(seeded, db, taskIds[3]!, 3, JSON.stringify(KEPT), 0)
  })
}

function trimmedNote(seeded: Seeded[]): Seeded {
  const found = seeded.find((item) => item.trimmed)
  expect(found, 'no trimmed note was seeded').toBeDefined()
  return found!
}

function seedMargin(userData: string, tasks: number, perTask: number): Seeded[] {
  return seed(userData, (db, seeded) => {
    for (let task = 0; task < tasks; task += 1) {
      const taskId = insertTask(db, `task ${task} needs a little more text to wrap`, task)
      for (let copy = 0; copy < perTask; copy += 1) push(seeded, db, taskId, task, '[]', seeded.length)
    }
  })
}

interface Box {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

function marginState(page: Page): Promise<{ boxes: Box[]; listLeft: number; listTop: number; zoom: number }> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.react-flow__node-mainList')?.getBoundingClientRect()
    const out: Box[] = []
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node-aiComment'))) {
      const rect = node.getBoundingClientRect()
      out.push({
        id: node.dataset.id ?? '',
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      })
    }
    const transform = document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? ''
    const scale = Number.parseFloat(transform.match(/scale\(([\d.]+)\)/)?.[1] ?? '1')
    return { boxes: out, listLeft: list?.left ?? 0, listTop: list?.top ?? 0, zoom: scale || 1 }
  })
}

async function boxes(page: Page): Promise<Box[]> {
  return (await marginState(page)).boxes
}

function overlaps(boxes: Box[]): string[] {
  const bad: string[] = []
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!
      const b = boxes[j]!
      if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) continue
      bad.push(`${a.id} over ${b.id}`)
    }
  }
  return bad
}

// A settle is a glide: it lands one frame after the last measurement arrives. Reading
// the column before it is quiet measures a frame that is already being replaced, so
// every layout assertion waits for two identical, idle frames first.
async function settledBoxes(page: Page): Promise<Box[]> {
  let previous: Box[] = []
  await expect
    .poll(
      async () => {
        const idle = await page.evaluate(() => (window as unknown as LayoutWindow).__branchlogLayout?.idle() ?? true)
        const found = await boxes(page)
        const still = idle && sameLayout(previous, found)
        previous = found
        if (overlaps(found).length > 0) return 'overlapping'
        return still ? 'settled' : 'moving'
      },
      { message: 'the margin column never came to rest' },
    )
    .toBe('settled')
  return previous
}

function sameLayout(a: Box[], b: Box[]): boolean {
  if (a.length !== b.length) return false
  return a.every((box, index) => {
    const other = b[index]!
    return box.id === other.id && box.top === other.top && box.bottom === other.bottom
  })
}

async function expectClearMargin(page: Page, count: number): Promise<Box[]> {
  await expect(page.locator('.react-flow__node-aiComment')).toHaveCount(count)
  const found = await settledBoxes(page)
  expect(overlaps(found), 'margin comments paint over one another').toEqual([])
  return found
}

// The column hugs the main list on its own side of it, never on top of it.
async function expectLeftOfList(page: Page): Promise<void> {
  const state = await marginState(page)
  for (const box of state.boxes) expect(box.right).toBeLessThanOrEqual(state.listLeft + 1)
}

function byId(boxes: Box[], id: string): Box {
  const found = boxes.find((box) => box.id === id)
  expect(found, `missing box for ${id}`).toBeDefined()
  return found!
}

interface Arrow {
  id: string
  tipX: number
  tipY: number
  points: { x: number; y: number }[]
}

// The path is sampled, not only measured by its box: a straight run across a note is
// invisible in a bounding box and obvious in the points.
function arrows(page: Page): Promise<Arrow[]> {
  return page.evaluate(() => {
    const out: Arrow[] = []
    for (const edge of Array.from(document.querySelectorAll<SVGGElement>('.react-flow__edge.ai-edge'))) {
      const path = edge.querySelector<SVGPathElement>('path')
      if (!path) continue
      const matrix = path.getScreenCTM()
      const length = path.getTotalLength()
      const points: { x: number; y: number }[] = []
      for (let step = 0; step <= 24; step += 1) {
        const local = path.getPointAtLength((length * step) / 24)
        const moved = matrix ? local.matrixTransform(matrix) : local
        points.push({ x: moved.x, y: moved.y })
      }
      const tip = points[points.length - 1]!
      out.push({ id: edge.dataset.id ?? '', tipX: tip.x, tipY: tip.y, points })
    }
    return out
  })
}

// Where an arrow must land: the task's own handle, which the stylesheet levels with the
// checkbox centre.
function handleCentre(page: Page, taskId: string): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const handle = document.querySelector<HTMLElement>(`[data-handleid="${CSS.escape(id)}"]`)
    if (!handle) return { x: Number.NaN, y: Number.NaN }
    const rect = handle.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, `in-${taskId}`)
}

function textBounds(page: Page): Promise<{ id: string; left: number; top: number; right: number; bottom: number }[]> {
  return page.evaluate(() => {
    const out: { id: string; left: number; top: number; right: number; bottom: number }[] = []
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node-aiComment'))) {
      const text = node.querySelector<HTMLElement>('[data-ai-text]')
      if (!text) continue
      const rect = text.getBoundingClientRect()
      out.push({ id: node.dataset.id ?? '', left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
    }
    return out
  })
}

async function panFrames(page: Page): Promise<number> {
  await page.evaluate(() => {
    const state = { frames: 0, stop: false }
    ;(window as unknown as { __marginPan: typeof state }).__marginPan = state
    const tick = (): void => {
      if (state.stop) return
      state.frames += 1
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const pane = await page.locator('.react-flow__pane').boundingBox()
  const started = Date.now()
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.move((pane?.x ?? 0) + (pane?.width ?? 600) / 2, (pane?.y ?? 0) + (pane?.height ?? 400) / 2)
    await page.mouse.wheel(0, 40)
  }
  const seconds = Math.max(0.001, (Date.now() - started) / 1000)
  return page.evaluate((elapsed) => {
    const state = (window as unknown as { __marginPan: { frames: number; stop: boolean } }).__marginPan
    const frames = state.frames
    state.stop = true
    return frames / elapsed
  }, seconds)
}

function note(page: Page, id: string) {
  return page.locator(`[data-ai-comment="${id}"]`)
}

test.describe('left margin layout', () => {
  test('a crowded margin becomes one column: newest first, 16px apart, dots for the rest', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
    const seeded = seedCrowded(dir)
    const { app, page, userData } = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    try {
      const found = await expectClearMargin(page, seeded.length)
      const state = await marginState(page)
      expect(state.zoom).toBe(1)
      for (const box of state.boxes) expect(box.left).toBe(state.boxes[0]!.left)

      const three = seeded.filter((item) => item.taskIndex === 5)
      expect(three).toHaveLength(3)
      const [oldest, middle, newest] = three
      // Nothing is lifted above the spot they were seeded on: the column only grows down.
      expect(Math.min(...found.map((box) => box.top))).toBe(Math.round(state.listTop + SEED_Y))
      // Within one line the newest holds its place and the older notes give way below it.
      expect(byId(found, middle!.commentId).top).toBeGreaterThanOrEqual(byId(found, newest!.commentId).bottom + GAP - 1)
      // The third waits as a dot, and opening it still costs nobody an overlap.
      await expect(page.locator('[data-ai-dot]')).toHaveCount(1)
      expect(byId(found, oldest!.commentId).top).toBeGreaterThanOrEqual(byId(found, middle!.commentId).bottom + GAP - 1)
      await page.locator(`[data-ai-dot="${oldest!.commentId}"]`).click()
      await expect(page.locator('[data-ai-dot]')).toHaveCount(0)
      const opened = await expectClearMargin(page, seeded.length)
      await expectLeftOfList(page)
      expect(byId(opened, oldest!.commentId).top).toBeGreaterThanOrEqual(byId(opened, middle!.commentId).bottom + GAP - 1)
    } finally {
      await closeApp(app, userData)
    }
  })

  test('every comment renders its text once, trimmed and full sharing one element', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
    const seeded = seedCrowded(dir)
    const { app, page, userData } = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    try {
      await expect(page.locator('.react-flow__node-aiComment')).toHaveCount(seeded.length)
      const report = await page.evaluate(() => {
        const notes: { id: string; dot: boolean; texts: number; keeps: number; hidden: number; shown: string; all: string; ellipsis: number }[] = []
        for (const node of Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node-aiComment'))) {
          const text = node.querySelector<HTMLElement>('[data-ai-text]')
          // Every phrase of the note is one child of the same run: the trimmed reading
          // hides children in place rather than drawing a second copy of the words.
          const holders = text ? Array.from(text.querySelectorAll<HTMLElement>('.ai-keep-text > *')) : []
          const words = holders.filter((el) => !el.hasAttribute('data-keep-ellipsis'))
          notes.push({
            id: node.dataset.id ?? '',
            dot: node.querySelector('[data-ai-dot]') !== null,
            texts: node.querySelectorAll('[data-ai-text]').length,
            keeps: node.querySelectorAll('[data-keep-text]').length,
            hidden: words.filter((el) => el.classList.contains('sr-only')).length,
            shown: words.filter((el) => !el.classList.contains('sr-only')).map((el) => el.textContent ?? '').join(''),
            all: words.map((el) => el.textContent ?? '').join(''),
            ellipsis: holders.length - words.length,
          })
        }
        return { notes, inDocument: document.querySelectorAll('[data-ai-text]').length }
      })
      // One element per comment: the doubled look was two notes sharing a spot, never a
      // second copy of the same text. A dot is the collapsed form of a note, so it holds
      // no text element at all, and nothing floats outside a comment node.
      const shown = report.notes.filter((item) => !item.dot)
      expect(report.notes.filter((item) => item.dot)).toHaveLength(1)
      expect(shown).toHaveLength(seeded.length - 1)
      expect(report.inDocument).toBe(shown.length)
      for (const item of report.notes) {
        expect(item.texts).toBeLessThanOrEqual(1)
        if (!item.dot) expect(item.texts).toBe(1)
        expect(item.keeps).toBe(item.dot ? 0 : 1)
        // A note with nothing kept shows all of it and hides nothing.
        if (item.id !== trimmedNote(seeded).commentId) expect(item.hidden).toBe(0)
      }
      const trimmed = report.notes.find((item) => item.id === trimmedNote(seeded).commentId)
      expect(trimmed).toBeDefined()
      // The whole text is in the document exactly once, in one element, and the trimmed
      // reading is a subset of it with one marker where the hidden middle sits.
      expect(trimmed!.all).toBe(LONG_TEXT)
      expect(trimmed!.hidden).toBeGreaterThan(0)
      expect(trimmed!.ellipsis).toBe(KEPT.length - 1)
      expect(trimmed!.shown).toBe('doesfirst')
      expect(trimmed!.shown.length).toBeLessThan(trimmed!.all.length)
    } finally {
      await closeApp(app, userData)
    }
  })

  test('a trimmed note reveals on hover and collapses again, clear at both sizes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
    const seeded = seedCrowded(dir)
    const { app, page, userData } = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    try {
      const trimmed = trimmedNote(seeded)
      const box = note(page, trimmed.commentId)
      await expect(box).toHaveAttribute('data-ai-expanded', 'false')
      const before = await expectClearMargin(page, seeded.length)
      const mark = box.locator('[data-kept-range]').first()
      await mark.hover()
      await expect(box).toHaveAttribute('data-ai-expanded', 'true')
      const revealed = await expectClearMargin(page, seeded.length)
      expect(byId(revealed, trimmed.commentId).bottom).toBeGreaterThan(byId(before, trimmed.commentId).bottom)

      await page.mouse.move(4, 4)
      await expect(box).toHaveAttribute('data-ai-expanded', 'false')
      const folded = await expectClearMargin(page, seeded.length)
      expect(byId(folded, trimmed.commentId).bottom).toBe(byId(before, trimmed.commentId).bottom)

      // The reveal is a view state, not a position: hovering the same phrase a second
      // time lands on the same box, and folding returns to the exact rest geometry.
      await mark.hover()
      await expect(box).toHaveAttribute('data-ai-expanded', 'true')
      const again = await expectClearMargin(page, seeded.length)
      expect(byId(again, trimmed.commentId).bottom).toBe(byId(revealed, trimmed.commentId).bottom)
      await page.mouse.move(4, 4)
      await expect(box).toHaveAttribute('data-ai-expanded', 'false')
      const refolded = await expectClearMargin(page, seeded.length)
      expect(byId(refolded, trimmed.commentId).bottom).toBe(byId(before, trimmed.commentId).bottom)
    } finally {
      await closeApp(app, userData)
    }
  })

  test('a reply thread that grows the box pushes its neighbours down', async () => {
    const mock = await startMockLmStudio()
    const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
    const seeded = seedCrowded(dir)
    const { app, page, userData } = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    try {
      await enableAi(page, mock.url, { pauseMs: 60_000 })
      const target = seeded[0]!
      const box = note(page, target.commentId)
      const before = await expectClearMargin(page, seeded.length)
      const belowBefore = before.filter((item) => item.top > byId(before, target.commentId).top).map((item) => item.top)
      expect(belowBefore.length).toBeGreaterThan(0)

      mock.setChatMode('reply')
      await box.locator('.ai-reply-input').fill('Give one smaller step.')
      await box.locator('[aria-label="Send reply"]').click()
      await expect(box.locator('[data-ai-replies] p')).toHaveCount(2)

      const grown = await expectClearMargin(page, seeded.length)
      expect(byId(grown, target.commentId).bottom).toBeGreaterThan(byId(before, target.commentId).bottom)
      const grownBelow = grown.filter((item) => item.top > byId(grown, target.commentId).top).map((item) => item.top)
      expect(grownBelow).toHaveLength(belowBefore.length)
      for (let index = 0; index < grownBelow.length; index += 1) {
        expect(grownBelow[index]!, `neighbour ${index} did not give way`).toBeGreaterThan(belowBefore[index]!)
      }
      await expectLeftOfList(page)
    } finally {
      await closeApp(app, userData)
      await mock.close()
    }
  })

  test('resolve, keep and delete each leave the margin clear', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
    const seeded = seedCrowded(dir)
    const { app, page, userData } = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    try {
      await expectClearMargin(page, seeded.length)

      const first = note(page, seeded[0]!.commentId)
      await first.hover()
      await first.locator('[aria-label="Resolve comment"]').click()
      await expectClearMargin(page, seeded.length - 1)

      const kept = note(page, seeded[1]!.commentId)
      await kept.hover()
      await mouseSelect(page, kept.locator('[data-ai-text] [data-keep-text]'), 5, 9)
      await page.locator('[data-keep-pin]').click()
      await expect(kept.locator('[data-kept-range]')).toHaveCount(1)
      await expect(kept).toHaveAttribute('data-ai-expanded', 'false')
      await expectClearMargin(page, seeded.length - 1)

      // A note that keeps phrases folds its own controls away, so the delete link is
      // reached the way the page intends: reveal by hovering a kept phrase first.
      await kept.locator('[data-kept-range]').first().hover()
      await kept.locator('[aria-label="Delete"]').click()
      await expectClearMargin(page, seeded.length - 2)
      await expectLeftOfList(page)
    } finally {
      await closeApp(app, userData)
    }
  })

  test('arrows stay in the gutter and land on their own bullet', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
    const seeded = seedCrowded(dir)
    const { app, page, userData } = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    try {
      const found = await expectClearMargin(page, seeded.length)
      const state = await marginState(page)
      const drawn = await arrows(page)
      const texts = await textBounds(page)
      expect(drawn).toHaveLength(seeded.length)

      for (const item of seeded) {
        const edge = drawn.find((candidate) => candidate.id === `edge-ai-${item.commentId}`)
        expect(edge, `no arrow for ${item.commentId}`).toBeDefined()
        const box = byId(found, item.commentId)
        // The whole run stays right of the column and left of the list it points at.
        expect(Math.min(...edge!.points.map((point) => point.x))).toBeGreaterThanOrEqual(box.right - 1)
        expect(Math.max(...edge!.points.map((point) => point.x))).toBeLessThanOrEqual(state.listLeft + 2)
        for (const other of texts) {
          for (const point of edge!.points) {
            // Grazing the edge is the attach point, not a run over the words.
            const crosses = point.x > other.left + 1 && point.x < other.right - 1 && point.y > other.top + 1 && point.y < other.bottom - 1
            expect(crosses, `arrow ${edge!.id} crosses the text of ${other.id}`).toBe(false)
          }
        }
        const handle = await handleCentre(page, item.taskId)
        expect(Math.abs(edge!.tipX - handle.x)).toBeLessThanOrEqual(2)
        expect(Math.abs(edge!.tipY - handle.y)).toBeLessThanOrEqual(2)
      }
    } finally {
      await closeApp(app, userData)
    }
  })

  test('a restart brings the settled column back with the same positions', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
    const seeded = seedCrowded(dir)
    const first = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    const saved = await expectClearMargin(first.page, seeded.length)
    await closeApp(first.app, first.userData, true)
    const reopened = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    try {
      const back = await expectClearMargin(reopened.page, seeded.length)
      for (const box of back) {
        const before = saved.find((item) => item.id === box.id)!
        expect(Math.abs(before.top - box.top), `the column moved on restart`).toBeLessThanOrEqual(1)
      }
      await expectLeftOfList(reopened.page)
    } finally {
      await closeApp(reopened.app, reopened.userData)
    }
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`a crowded margin photographs as one readable column in ${scheme}`, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
      const seeded = seedCrowded(dir)
      const { app, page, userData } = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
      try {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
        await expectClearMargin(page, seeded.length)
        const state = await marginState(page)
        const list = await page.locator('.task-list').boundingBox()
        await expect(page).toHaveScreenshot(`margin-crowded-${scheme}.png`, {
          clip: {
            x: Math.max(0, state.boxes[0]!.left - 8),
            y: Math.max(0, state.listTop + SEED_Y - 40),
            width: (list?.right ?? state.listLeft + 560) - state.boxes[0]!.left + 16,
            height: 560,
          },
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
        })
      } finally {
        await closeApp(app, userData)
      }
    })
  }

  test('forty comments cost neither the keystroke nor the pan', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'branchlog-margin-'))
    const seeded = seedMargin(dir, 20, 2)
    const { app, page, userData } = await launchApp(dir, { env: { BRANCHLOG_NOW: NOW } })
    try {
      expect(seeded).toHaveLength(40)
      await expectClearMargin(page, seeded.length)
      await expectLeftOfList(page)

      const sentence = 'a sentence long enough to make the margin re-measure more than once'
      const field = page.locator('[data-task-text]').first()
      await field.click()
      await page.keyboard.press(`${modifier}+End`)
      const started = Date.now()
      await page.keyboard.type(sentence, { delay: 8 })
      await expect(field).toContainText(sentence)
      expect(Date.now() - started).toBeLessThan(6_000)
      await expectClearMargin(page, seeded.length)

      const fps = await panFrames(page)
      expect(fps).toBeGreaterThanOrEqual(20)
      await expectClearMargin(page, seeded.length)
    } finally {
      await closeApp(app, userData)
    }
  })
})
