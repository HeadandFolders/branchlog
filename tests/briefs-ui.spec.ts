import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { localDateKey } from '../src/shared/dates.ts'
import { closeDatabase, initDatabase } from '../src/main/database.ts'
import { refreshBrief } from '../src/main/briefs.ts'
import { closeApp, launchApp, modifier, writeTask } from './launch.ts'

const dirs: string[] = []

interface Seeded {
  userData: string
  ids: Record<string, string>
}

// The panel links briefs through the system folder and file dialogs, which no test can drive, so a
// windowed run seeds the profile the way a notebook that already has briefs would look. The brief
// files keep their own folder: closeApp removes the profile it launched, and nothing ever holds the
// notes open, so this folder is the only one the run has to clear itself.
function linkBriefs(names: string[]): Seeded {
  const notes = mkdtempSync(path.join(tmpdir(), 'branchlog-briefs-ui-notes-'))
  dirs.push(notes)
  const userData = mkdtempSync(path.join(tmpdir(), 'branchlog-briefs-ui-'))
  const db = initDatabase(userData)
  const stamp = new Date().toISOString()
  const ids: Record<string, string> = {}
  for (const name of names) {
    const filePath = path.join(notes, `${name}.md`)
    writeFileSync(filePath, `# ${name}\nwhat ${name} is for`, 'utf8')
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

interface DayState {
  tasks: { text: string; projectId: string | null }[]
  comments: number
  note: string | null
}

function day(userData: string): DayState {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const date = localDateKey()
  const tasks = db
    .prepare(
      `SELECT text, projectId FROM tasks
       WHERE dateCreated = ? AND text <> '' AND side = 'main'
       ORDER BY orderIndex`,
    )
    .all(date) as DayState['tasks']
  const comments = (db.prepare('SELECT COUNT(*) AS n FROM aiComments').get() as { n: number }).n
  const row = db.prepare('SELECT text FROM dayNotes WHERE dateKey = ?').get(date) as { text: string } | undefined
  db.close()
  return { tasks, comments, note: row?.text ?? null }
}

function textOf(field: Locator): Promise<string> {
  return field.evaluate((element) => element.textContent ?? '')
}

// The caret, counted in characters from the start of the row, so a test can say the list moved nothing.
function caretOf(field: Locator): Promise<number> {
  return field.evaluate((element) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return -1
    const range = selection.getRangeAt(0)
    const before = range.cloneRange()
    before.selectNodeContents(element)
    before.setEnd(range.endContainer, range.endOffset)
    return before.toString().length
  })
}

function itemNames(popup: Locator): Promise<(string | null)[]> {
  return popup.locator('[data-brief-complete-item]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-brief-complete-item')),
  )
}

// The brief list arrives with the day and the panel is where the page shows it, so opening the panel is
// how a test knows a reference typed afterwards has something to match against.
async function waitBriefs(page: Page, count: number): Promise<void> {
  await page.keyboard.press(`${modifier}+,`)
  await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toBeVisible()
  await expect(page.locator('[data-brief]')).toHaveCount(count)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toHaveCount(0)
}

const NOTE = 'the day is about @alpha and @bravo, and @r the model'

test.afterEach(() => {
  closeDatabase()
})

test.afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

test('an empty day shows no note box, only the offer to write one when it is looked for', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const affordance = page.locator('[data-day-note-empty]')
    await expect(page.locator('[data-day-note-text]')).toHaveCount(0)
    await expect(affordance).toHaveCount(1)
    expect(await affordance.evaluate((element) => getComputedStyle(element).opacity)).toBe('0')
    await affordance.hover()
    await expect(affordance).toHaveCSS('opacity', '1')

    await affordance.click()
    await expect(page.locator('[data-day-note-text]')).toBeVisible()
    await expect(affordance).toHaveCount(0)
    expect(day(userData).note).toBeNull()
  } finally {
    await closeApp(app, userData)
  }
})

test('what the note says is back after a restart, and still is not a task', async () => {
  const seeded = linkBriefs(['alpha'])
  const userData = seeded.userData
  let launched = await launchApp(userData)
  try {
    await launched.page.locator('[data-day-note-empty]').click()
    const note = launched.page.locator('[data-day-note-text]')
    await expect(note).toBeVisible()
    await note.fill('ship it with @alpha')
    await note.blur()
    await expect.poll(() => day(userData).note).toBe('ship it with @alpha')

    await closeApp(launched.app, userData, true)
    launched = await launchApp(userData)
    await expect(launched.page.locator('[data-day-note-text]')).toHaveValue('ship it with @alpha')
    await expect(launched.page.locator('[data-day-note-empty]')).toHaveCount(0)
    expect(day(userData).tasks).toEqual([])
    await expect(launched.page.locator('[data-task-text]')).toHaveCount(0)
  } finally {
    await closeApp(launched.app, userData)
  }
})

test('the note holds no place in the day total, spends no comment, and binds nothing onto a row', async () => {
  const seeded = linkBriefs(['alpha', 'bravo'])
  const { app, page, userData } = await launchApp(seeded.userData)
  try {
    await waitBriefs(page, 2)
    await writeTask(page, 'a task that names @alpha')
    await expect.poll(() => day(userData).tasks).toEqual([{ text: 'a task that names @alpha', projectId: seeded.ids.alpha }])

    // The reference typed in the note is the day's, so the row keeps the one binding it already had.
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-brief-complete]')).toHaveCount(0)
    await page.locator('[data-day-note-empty]').click()
    const note = page.locator('[data-day-note-text]')
    await note.fill(NOTE)
    await note.blur()
    await expect.poll(() => day(userData).note).toBe(NOTE)

    const after = day(userData)
    expect(after.tasks).toEqual([{ text: 'a task that names @alpha', projectId: seeded.ids.alpha }])
    expect(after.comments).toBe(0)
    await expect(page.locator('[data-task-text]')).toHaveCount(1)
    await expect(page.locator('[data-task-text]')).not.toContainText('the day is about')
  } finally {
    await closeApp(app, userData)
  }
})

test('a row written whole into the New task box lands with its binding', async () => {
  const seeded = linkBriefs(['alpha'])
  const { app, page, userData } = await launchApp(seeded.userData)
  try {
    await waitBriefs(page, 1)
    // One change carrying the finished text, which is what a paste does, not a typed row's last keystroke.
    await page.getByRole('textbox', { name: 'New task' }).fill('paste @alpha and carry on')
    await expect(page.locator('[data-task-text]')).toHaveText('paste @alpha and carry on')
    await expect.poll(() => day(userData).tasks).toEqual([
      { text: 'paste @alpha and carry on', projectId: seeded.ids.alpha },
    ])
  } finally {
    await closeApp(app, userData)
  }
})

test('@ offers the request first and then the briefs by name, and choosing one binds it', async () => {
  const seeded = linkBriefs(['zeta', 'alpha'])
  const { app, page, userData } = await launchApp(seeded.userData)
  try {
    await waitBriefs(page, 2)
    const task = await writeTask(page, 'ship')
    await task.click()
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.type(' @')

    const popup = page.locator('[data-brief-complete]')
    await expect(popup).toBeVisible()
    expect(await itemNames(popup)).toEqual(['r', 'alpha', 'zeta'])
    await expect(popup.locator('[data-brief-complete-item]').first()).toHaveAttribute('data-active', 'true')
    // Opening the list gave nothing the focus it did not have and moved no caret.
    expect(await task.evaluate((element) => document.activeElement === element)).toBe(true)
    expect(await caretOf(task)).toBe(6)

    await page.keyboard.type('a')
    expect(await itemNames(popup)).toEqual(['alpha'])
    await page.keyboard.press('Enter')
    await expect(popup).toHaveCount(0)
    expect(await textOf(task)).toBe('ship @alpha ')
    expect(await caretOf(task)).toBe(12)
    // The Enter chose a candidate instead of splitting the row.
    await expect(page.locator('[data-task-text]')).toHaveCount(1)
    await expect.poll(() => day(userData).tasks).toEqual([{ text: 'ship @alpha ', projectId: seeded.ids.alpha }])

    await page.keyboard.type('@r')
    expect(await itemNames(popup)).toEqual(['r'])
    await page.keyboard.press('Enter')
    expect(await textOf(task)).toBe('ship @alpha @r ')
    // '@r' names no brief, so it leaves the binding the row already had alone.
    await expect.poll(() => day(userData).tasks).toEqual([{ text: 'ship @alpha @r ', projectId: seeded.ids.alpha }])

    // The accepted candidate left its own separating space, so the next reference needs no leading one.
    await page.keyboard.type('@z')
    await expect(popup).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    expect(await textOf(task)).toBe('ship @alpha @r @z')

    await page.keyboard.type('eta')
    expect(await textOf(task)).toBe('ship @alpha @r @zeta')
    await expect.poll(() => day(userData).tasks).toEqual([{ text: 'ship @alpha @r @zeta', projectId: seeded.ids.zeta }])
  } finally {
    await closeApp(app, userData)
  }
})
