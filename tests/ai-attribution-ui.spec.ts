import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, initDatabase } from '../src/main/database.ts'
import { refreshBrief } from '../src/main/briefs.ts'
import { closeApp, launchApp, modifier, writeTask } from './launch.ts'
import { addMainTask, chatPosts, enableAi } from './ai-helpers.ts'
import { startMockLmStudio, type MockLmStudio } from './mock-lm-studio.ts'

const DAY1 = '2026-11-01T12:00:00'
const DAY4 = '2026-11-04T12:00:00'
const PAUSE_MS = 500

// A name and a summary are what a row is matched against, so these two share nothing with the rows
// below — a row that names neither is a row no brief can answer for.
const BRIEF_BODIES: Record<string, string> = {
  inkwell: '# inkwell\nwax seal and nib stock',
  foundry: '# foundry\ncasting sand and mold repair',
}
const INKWELL_BODY_LINE = 'wax seal and nib stock'
const FOUNDRY_BODY_LINE = 'casting sand and mold repair'

// One brief's own word, and the other brief's word nowhere.
const MATCH_INKWELL = 'order more inkwell nibs before friday'
// No brief's word at all, so nothing singles one out.
const MATCH_NONE = 'rewrite the vendor agreement'
// The row names its brief, which outranks any word it also happens to contain.
const BOUND_FOUNDRY = 'order more nibs before friday @foundry'

const dirs: string[] = []

interface Seeded {
  userData: string
  ids: Record<string, string>
}

// The panel links briefs through dialogs no test can drive, so a run seeds the profile the way a
// notebook that already has two briefs would look.
function linkBriefs(names: string[]): Seeded {
  const notes = mkdtempSync(path.join(tmpdir(), 'branchlog-attribution-notes-'))
  dirs.push(notes)
  const userData = mkdtempSync(path.join(tmpdir(), 'branchlog-attribution-'))
  const db = initDatabase(userData)
  const stamp = new Date().toISOString()
  const ids: Record<string, string> = {}
  for (const name of names) {
    const filePath = path.join(notes, `${name}.md`)
    writeFileSync(filePath, BRIEF_BODIES[name] ?? `# ${name}`, 'utf8')
    const id = randomUUID()
    db
      .prepare(
        `INSERT INTO aiBriefs (
           id, name, filePath, summary, contentHash, mtimeMs, enabled, alwaysInclude, createdAt, updatedAt
         ) VALUES (?, ?, ?, '', '', 0, 1, 0, ?, ?)`,
      )
      .run(id, name, filePath, stamp, stamp)
    refreshBrief(id)
    ids[name] = id
  }
  closeDatabase()
  return { userData, ids }
}

interface TaskRow {
  text: string
  projectId: string | null
  dismissed: number
  dateCreated: string
}

function readTasks(userData: string): TaskRow[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db
    .prepare(
      `SELECT text, projectId, projectHoldDismissed AS dismissed, dateCreated FROM tasks
       WHERE side = 'main' AND text <> ''
       ORDER BY dateCreated, orderIndex`,
    )
    .all() as TaskRow[]
  db.close()
  return rows
}

interface CommentLabel {
  projectId: string | null
  pinned: number
}

function readComments(userData: string): CommentLabel[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db
    .prepare('SELECT projectId, projectPinned AS pinned FROM aiComments ORDER BY createdAt, rowid')
    .all() as CommentLabel[]
  db.close()
  return rows
}

function prompts(mock: MockLmStudio): string[] {
  return chatPosts(mock).map((post) => JSON.stringify(post.body?.messages ?? []))
}

// The list the hold decides against is the list the page reads with the day, so waiting for the panel
// to count the briefs is how a test knows a row typed after it has something to match against.
async function enable(page: Page, mock: MockLmStudio, briefCount: number): Promise<void> {
  await enableAi(page, mock.url, { pauseMs: PAUSE_MS })
  if (briefCount === 0) return
  await page.keyboard.press(`${modifier}+,`)
  await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toBeVisible()
  await expect(page.locator('[data-brief]')).toHaveCount(briefCount)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toHaveCount(0)
}

const holdOn = (page: Page) => page.locator('[data-project-hold]')
const chips = (page: Page) => page.locator('[data-project-chip]')
const picker = (page: Page) => page.locator('[data-brief-picker]')

// The tools row is revealed on hover, exactly as the keep and resolve links are, so the pointer has to
// be on the note before the chip on it can be clicked.
async function hoverNote(page: Page, index = 0): Promise<void> {
  await page.locator('[data-ai-comment]').nth(index).hover()
}

async function appendToField(page: Page, text: string): Promise<void> {
  const field = page.locator('[data-task-text]').first()
  await field.click()
  await page.keyboard.press(`${modifier}+End`)
  await page.keyboard.type(text)
}

test.afterEach(() => {
  closeDatabase()
})

test.afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

test('with no briefs linked nothing is held and the note wears no project', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enable(page, mock, 0)
    await writeTask(page, MATCH_NONE)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    await expect(holdOn(page)).toHaveCount(0)
    expect(chatPosts(mock)).toHaveLength(1)
    await expect(chips(page)).toHaveText('No project')
    await expect(chips(page)).toHaveAttribute('data-project-id', 'none')
    expect(readComments(userData)).toEqual([{ projectId: null, pinned: 0 }])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('one brief matched by its own words runs and the chip is marked auto', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  try {
    await enable(page, mock, 2)
    await writeTask(page, MATCH_INKWELL)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    await expect(holdOn(page)).toHaveCount(0)
    expect(chatPosts(mock)).toHaveLength(1)
    await expect(chips(page)).toHaveAttribute('data-project-id', seeded.ids.inkwell)
    await expect(chips(page)).toHaveAttribute('data-project-auto', 'true')
    await expect(chips(page)).toHaveText(/inkwell/)
    const [prompt] = prompts(mock)
    expect(prompt).toContain(INKWELL_BODY_LINE)
    expect(prompt).not.toContain(FOUNDRY_BODY_LINE)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a row that names its own brief is labelled by that and not marked auto', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  try {
    await enable(page, mock, 2)
    await writeTask(page, BOUND_FOUNDRY)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    expect(chatPosts(mock)).toHaveLength(1)
    await expect(chips(page)).toHaveAttribute('data-project-id', seeded.ids.foundry)
    await expect(chips(page)).not.toHaveAttribute('data-project-auto')
    // The row's own '@foundry' outranks the inkwell words sitting in the same sentence.
    const [prompt] = prompts(mock)
    expect(prompt).toContain(FOUNDRY_BODY_LINE)
    expect(prompt).not.toContain(INKWELL_BODY_LINE)
    expect(readTasks(userData)[0]?.projectId).toBe(seeded.ids.foundry)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('the chip opens a picker and re-labels the note without asking again', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  try {
    await enable(page, mock, 2)
    await writeTask(page, MATCH_INKWELL)
    await expect(chips(page)).toHaveAttribute('data-project-id', seeded.ids.inkwell)

    await hoverNote(page)
    await chips(page).click()
    await expect(picker(page)).toBeVisible()
    await expect(picker(page).locator('[data-brief-pick]')).toHaveCount(3)
    await picker(page).locator(`[data-brief-pick="${seeded.ids.foundry}"]`).click()

    await expect(picker(page)).toHaveCount(0)
    await expect(chips(page)).toHaveAttribute('data-project-id', seeded.ids.foundry)
    await expect(chips(page)).toHaveAttribute('data-project-pinned', 'true')
    await expect(chips(page)).not.toHaveAttribute('data-project-auto')
    await expect(chips(page)).not.toHaveText(/auto/)

    // A label is a label: nothing was sent, and nothing else was written.
    expect(chatPosts(mock)).toHaveLength(1)
    expect(readComments(userData)).toEqual([{ projectId: seeded.ids.foundry, pinned: 1 }])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a chosen label survives the next comment on the same row', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  try {
    await enable(page, mock, 2)
    await writeTask(page, MATCH_INKWELL)
    await expect(chips(page)).toHaveCount(1)
    await hoverNote(page)
    await chips(page).click()
    await picker(page).locator(`[data-brief-pick="${seeded.ids.foundry}"]`).click()
    await expect(chatPosts(mock)).toHaveLength(1)

    // The row still says inkwell and nothing else, so only the pin keeps the next note on foundry.
    await appendToField(page, ' twice before friday')
    await expect(page.locator('[data-ai-comment]')).toHaveCount(2)
    await expect(chips(page).nth(1)).toHaveAttribute('data-project-id', seeded.ids.foundry)
    await expect(chips(page).nth(1)).toHaveAttribute('data-project-pinned', 'true')
    await expect(chips(page).nth(1)).not.toHaveAttribute('data-project-auto')

    const second = prompts(mock).at(-1) ?? ''
    expect(second).toContain(FOUNDRY_BODY_LINE)
    expect(second).not.toContain(INKWELL_BODY_LINE)
    expect(readComments(userData)).toEqual([
      { projectId: seeded.ids.foundry, pinned: 1 },
      { projectId: seeded.ids.foundry, pinned: 1 },
    ])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a row no brief answers for is asked instead of spent', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  try {
    await enable(page, mock, 2)
    await writeTask(page, MATCH_NONE)
    await expect(holdOn(page)).toHaveCount(1)
    await expect(holdOn(page)).toHaveText('Which project?')
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    expect(chatPosts(mock)).toHaveLength(0)
    expect(readComments(userData)).toEqual([])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('three questions a day is the most the margin asks', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  try {
    await enable(page, mock, 2)
    await writeTask(page, MATCH_NONE)
    await expect(holdOn(page)).toHaveCount(1)
    await addMainTask(page, 'review the insurance paperwork')
    await addMainTask(page, 'postpone the garden fence painting')
    await addMainTask(page, 'answer the mailbox question queue')
    await expect(holdOn(page)).toHaveCount(3)
    await expect(page.locator('[data-task-text]')).toHaveCount(4)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    expect(chatPosts(mock)).toHaveLength(0)
    expect(readComments(userData)).toEqual([])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('picking a brief binds the row and asks once', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  try {
    await enable(page, mock, 2)
    await writeTask(page, MATCH_NONE)
    await expect(holdOn(page)).toHaveCount(1)

    await holdOn(page).click()
    await expect(picker(page)).toBeVisible()
    await picker(page).locator(`[data-brief-pick="${seeded.ids.inkwell}"]`).click()

    await expect(holdOn(page)).toHaveCount(0)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    await expect(chips(page)).toHaveAttribute('data-project-id', seeded.ids.inkwell)
    // The bind is the row's own '@inkwell', so the chip is a binding, not a guess.
    await expect(chips(page)).not.toHaveAttribute('data-project-auto')
    expect(await page.locator('[data-task-text]').first().textContent()).toBe(`${MATCH_NONE} @inkwell`)
    await expect.poll(() => readTasks(userData)[0]?.projectId).toBe(seeded.ids.inkwell)

    const before = chatPosts(mock).length
    expect(before).toBe(1)
    // One ask for the pick, and the pause over the text it changed never spends a second one.
    await page.waitForTimeout(2_000)
    expect(chatPosts(mock)).toHaveLength(1)
    expect(readComments(userData)).toEqual([{ projectId: seeded.ids.inkwell, pinned: 0 }])

    await page.keyboard.press(`${modifier}+z`)
    await expect(page.locator('[data-task-text]').first()).toHaveText(MATCH_NONE)
    await expect.poll(() => readTasks(userData)[0]?.projectId).toBe(null)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('answering no project asks once and never asks again', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  try {
    await enable(page, mock, 2)
    await writeTask(page, MATCH_NONE)
    await expect(holdOn(page)).toHaveCount(1)

    await holdOn(page).click()
    await picker(page).locator('[data-brief-pick="none"]').click()

    await expect(holdOn(page)).toHaveCount(0)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    await expect(chips(page)).toHaveText('No project')
    await expect.poll(() => readTasks(userData)[0]?.dismissed).toBe(1)
    expect(chatPosts(mock)).toHaveLength(1)
    expect(readTasks(userData)[0]?.text).toBe(MATCH_NONE)

    // The row was never held again after that: the next edit earns a note, not a second question.
    await appendToField(page, ' before friday')
    await expect(page.locator('[data-ai-comment]')).toHaveCount(2)
    await expect(holdOn(page)).toHaveCount(0)
    expect(chatPosts(mock)).toHaveLength(2)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a row that said no project still says it on the day it is carried to', async () => {
  const seeded = linkBriefs(['inkwell', 'foundry'])
  const mock = await startMockLmStudio()
  const first = await launchApp(seeded.userData, { env: { BRANCHLOG_NOW: DAY1 } })
  let app = first.app
  const userData = first.userData
  try {
    await enable(first.page, mock, 2)
    await writeTask(first.page, MATCH_NONE)
    await expect(holdOn(first.page)).toHaveCount(1)
    await holdOn(first.page).click()
    await picker(first.page).locator('[data-brief-pick="none"]').click()
    await expect(first.page.locator('[data-ai-comment]')).toHaveCount(1)
    await expect.poll(() => readTasks(userData)[0]?.dismissed).toBe(1)

    await closeApp(app, userData, true)
    const again = await launchApp(userData, { env: { BRANCHLOG_NOW: DAY4 } })
    app = again.app
    await expect(again.page.locator('[data-task-text]')).toHaveCount(1)
    expect(readTasks(userData).map((row) => [row.dateCreated, row.dismissed])).toEqual([
      ['2026-11-01', 1],
      ['2026-11-04', 1],
    ])

    const postsBefore = chatPosts(mock).length
    await enable(again.page, mock, 2)
    await appendToField(again.page, ' twice before friday')
    await expect(again.page.locator('[data-ai-comment]')).toHaveCount(1)
    // The copy is the same task the person already answered about, so it is not asked twice.
    await expect(holdOn(again.page)).toHaveCount(0)
    expect(chatPosts(mock)).toHaveLength(postsBefore + 1)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})
