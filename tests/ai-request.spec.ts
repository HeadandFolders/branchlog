import path from 'node:path'
import Database from 'better-sqlite3'
import { readdir, stat } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { addMainTask, chatPosts, enableAi } from './ai-helpers'
import { closeApp, launchApp, modifier, writeTask } from './launch'
import {
  MOCK_FILE_BODY,
  MOCK_FILE_NAME,
  startMockLmStudio,
} from './mock-lm-studio'
import {
  ANSWER_REPLY_SYSTEM_PROMPT,
  ANSWER_REPLY_SYSTEM_PROMPT_PLAIN,
  ANSWER_SYSTEM_PROMPT,
  ANSWER_SYSTEM_PROMPT_PLAIN,
  COMMENT_SYSTEM_PROMPT,
  COMMENT_SYSTEM_PROMPT_PLAIN,
  REPLY_SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT_PLAIN,
  REQUEST_SYSTEM_PROMPT,
  REQUEST_SYSTEM_PROMPT_PLAIN,
} from '../src/main/ai-prompts'
import { splitRequestPrefix } from '../src/shared/ai-request'

interface DbRow {
  [key: string]: unknown
}

function readDb(userData: string): { comments: DbRow[]; tasks: DbRow[] } {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const comments = db.prepare('SELECT * FROM aiComments ORDER BY rowid').all() as DbRow[]
  const tasks = db.prepare('SELECT id, text, side FROM tasks ORDER BY rowid').all() as DbRow[]
  db.close()
  return { comments, tasks }
}

async function listProfileFiles(dir: string): Promise<string[]> {
  const entries: string[] = []
  async function walk(current: string): Promise<void> {
    for (const name of await readdir(current)) {
      if (name.startsWith('branchlog.sqlite') || name === 'lockfile' || name === 'instance.pid') continue
      const full = path.join(current, name)
      const info = await stat(full)
      if (info.isDirectory()) await walk(full)
      else entries.push(path.relative(dir, full))
    }
  }
  await walk(dir)
  return entries.sort()
}

async function setAiGates(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((fields) => {
    const current = window.branchlog.ai.settings()
    window.branchlog.ai.setSettings({ ...current, ...fields })
  }, patch)
  await page.keyboard.press(`${modifier}+,`)
  await expect(page.getByRole('complementary', { name: 'AI margin settings' })).toBeVisible()
  await page.keyboard.press('Escape')
}

test('@r on a main row answers on commit, not on the pause, and creates its branch then', async () => {
  const mock = await startMockLmStudio({ chatMode: 'plain' })
  const { app, page, userData } = await launchApp()
  try {
    await writeTask(page, 'buy stamps')
    await enableAi(page, mock.url, { pauseMs: 1200 })
    await addMainTask(page, '@r draft the vendor email')
    await page.waitForTimeout(1600)
    expect(chatPosts(mock)).toHaveLength(0)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
    await expect(page.locator('.react-flow__node-aiComment')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Enter`)
    const branch = page.locator('.react-flow__node-branch').first()
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await expect(branch.locator('[data-task-text]')).toHaveText('draft the vendor email')
    await expect(page.locator('[data-task-text]').first()).toHaveText('@r draft the vendor email')
    const posts = chatPosts(mock)
    expect(posts).toHaveLength(1)
    const messages = posts[0].body?.messages as { role: string; content: string }[]
    expect(messages[0].content).toBe(REQUEST_SYSTEM_PROMPT)
    expect(messages[1].content).toContain('draft the vendor email')
    expect(messages[1].content).not.toContain('@r')
    expect(posts[0].body?.tools).toBeDefined()
    expect(posts[0].body?.response_format).toBeUndefined()
    const rows = readDb(userData).tasks
    expect(rows.find((row) => row.text === '@r draft the vendor email')?.side).toBe('main')
    expect(rows.find((row) => row.text === 'draft the vendor email')?.side).toBe('right')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a QUESTION: reply yields a question and no deliverable', async () => {
  const mock = await startMockLmStudio({ chatMode: 'question' })
  const { app, page, userData } = await launchApp()
  try {
    await writeTask(page, 'buy stamps')
    await enableAi(page, mock.url)
    await addMainTask(page, '@r draft the vendor email')
    await page.keyboard.press(`${modifier}+Enter`)
    const branch = page.locator('.react-flow__node-branch').first()
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await expect(branch.locator('[data-ai-text]')).toHaveText('Which vendor should the email go to?')
    const { comments } = readDb(userData)
    expect(comments).toHaveLength(1)
    expect((comments[0] as { type: string }).type).toBe('question')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a plain reply yields a deliverable', async () => {
  const mock = await startMockLmStudio({ chatMode: 'plain' })
  const { app, page, userData } = await launchApp()
  try {
    await writeTask(page, 'buy stamps')
    await enableAi(page, mock.url)
    await addMainTask(page, '@r draft the vendor email')
    await page.keyboard.press(`${modifier}+Enter`)
    const branch = page.locator('.react-flow__node-branch').first()
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await expect(branch.locator('[data-ai-text]')).toHaveText('Try a smaller first step.')
    const { comments } = readDb(userData)
    expect((comments[0] as { type: string }).type).toBe('remark')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a save_file call yields pendingSave and writes nothing', async () => {
  const mock = await startMockLmStudio({ chatMode: 'tool-save' })
  const { app, page, userData } = await launchApp()
  try {
    await writeTask(page, 'buy stamps')
    await enableAi(page, mock.url)
    await addMainTask(page, '@r draft the vendor email')
    await page.keyboard.press(`${modifier}+Enter`)
    const branch = page.locator('.react-flow__node-branch').first()
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await expect(branch.locator('[data-ai-text]')).toHaveText(MOCK_FILE_BODY)
    const before = await listProfileFiles(userData)
    const result = await page.evaluate(async () => {
      const branchId = document.querySelector<HTMLElement>('.react-flow__node-branch [data-task-id]')?.dataset.taskId ?? ''
      return window.branchlog.ai.ask({
        taskId: branchId,
        requestId: crypto.randomUUID(),
        text: 'draft the vendor email',
        request: true,
      })
    })
    expect(result).toMatchObject({
      kind: 'comment',
      pendingSave: { content: MOCK_FILE_BODY, suggestedName: MOCK_FILE_NAME },
    })
    expect((result as { comment: { type: string } }).comment.type).toBe('remark')
    const after = await listProfileFiles(userData)
    expect(after).toEqual(before)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('the pause remarks on an @r row only when remarkOnRequests is on', async () => {
  const mock = await startMockLmStudio({ chatMode: 'json' })
  const { app, page, userData } = await launchApp()
  try {
    await writeTask(page, 'buy stamps')
    await enableAi(page, mock.url, { pauseMs: 800 })
    await addMainTask(page, '@r draft the vendor email')
    await page.waitForTimeout(1400)
    expect(chatPosts(mock)).toHaveLength(0)
    await expect(page.locator('.react-flow__node-aiComment')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('the pause remarks on an @r row when remarkOnRequests is on', async () => {
  const mock = await startMockLmStudio({ chatMode: 'json' })
  const { app, page, userData } = await launchApp()
  try {
    await writeTask(page, 'buy stamps')
    await enableAi(page, mock.url, { pauseMs: 800 })
    await setAiGates(page, { remarkOnRequests: true })
    await addMainTask(page, '@r draft the vendor email')
    await page.waitForTimeout(1400)
    expect(chatPosts(mock)).toHaveLength(1)
    const posts = chatPosts(mock)
    const messages = posts[0].body?.messages as { role: string; content: string }[]
    expect(messages[0].content).toBe(COMMENT_SYSTEM_PROMPT)
    await expect(page.locator('.react-flow__node-aiComment')).toHaveCount(1)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a request never edits task text', async () => {
  const mock = await startMockLmStudio({ chatMode: 'plain' })
  const { app, page, userData } = await launchApp()
  try {
    await writeTask(page, 'buy stamps')
    await enableAi(page, mock.url)
    await addMainTask(page, '@r draft the vendor email')
    await page.keyboard.press(`${modifier}+Enter`)
    const branch = page.locator('.react-flow__node-branch').first()
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await expect(page.locator('[data-task-text]').first()).toHaveText('@r draft the vendor email')
    await expect(branch.locator('[data-task-text]')).toHaveText('draft the vendor email')
    const rows = readDb(userData).tasks
    const texts = rows.map((row) => row.text as string)
    expect(texts).toContain('@r draft the vendor email')
    expect(texts).toContain('draft the vendor email')
    expect(texts).not.toContain('Try a smaller first step.')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('the clarify rules appear in the default prompts and the plain variants omit them', () => {
  for (const prompt of [COMMENT_SYSTEM_PROMPT, REPLY_SYSTEM_PROMPT, ANSWER_SYSTEM_PROMPT, ANSWER_REPLY_SYSTEM_PROMPT]) {
    expect(prompt).toContain('Clarify before you guess')
  }
  for (const prompt of [COMMENT_SYSTEM_PROMPT_PLAIN, REPLY_SYSTEM_PROMPT_PLAIN, ANSWER_SYSTEM_PROMPT_PLAIN, ANSWER_REPLY_SYSTEM_PROMPT_PLAIN]) {
    expect(prompt).not.toContain('Clarify before you guess')
  }
})

test('the request prompt names save_file, QUESTION:, and the row-is-instruction rule', () => {
  expect(REQUEST_SYSTEM_PROMPT).toContain('save_file')
  expect(REQUEST_SYSTEM_PROMPT).toContain('QUESTION:')
  expect(REQUEST_SYSTEM_PROMPT).toContain("the request row is the person's own instruction")
  expect(REQUEST_SYSTEM_PROMPT).toContain('Clarify before you guess')
  expect(REQUEST_SYSTEM_PROMPT_PLAIN).not.toContain('Clarify before you guess')
})

test('the request prompt still demotes notebook text to context', () => {
  for (const prompt of [REQUEST_SYSTEM_PROMPT, REQUEST_SYSTEM_PROMPT_PLAIN]) {
    expect(prompt).toContain('Every other notebook row is context')
  }
})

test('splitRequestPrefix recognises only a leading "@r " or "@r\\n"', () => {
  expect(splitRequestPrefix('@r draft the plan').isRequest).toBe(true)
  expect(splitRequestPrefix('@r\ndraft the plan').isRequest).toBe(true)
  expect(splitRequestPrefix('@rdraft').isRequest).toBe(false)
  expect(splitRequestPrefix(' @r draft').isRequest).toBe(false)
  expect(splitRequestPrefix('@r ').isRequest).toBe(false)
  expect(splitRequestPrefix('@r\n').isRequest).toBe(false)
  expect(splitRequestPrefix('@r draft').body).toBe('draft')
})
