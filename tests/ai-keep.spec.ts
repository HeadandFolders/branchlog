import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'
import { enableAi } from './ai-helpers'
import { startMockLmStudio } from './mock-lm-studio'

const TASK_TEXT = 'ship the quarterly report'
const COMMENT_TEXT = 'What does done look like for this?'

function commentWrapper(page: Page): Locator {
  return page.locator('[data-ai-text] [data-keep-text]')
}

async function selectOffsets(page: Page, wrapper: Locator, start: number, end: number): Promise<void> {
  await wrapper.evaluate((element, offsets) => {
    const pieces: { node: Text; start: number; length: number }[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const text = node as Text
      const holder = text.parentElement?.closest('[data-offset]')
      if (holder && element.contains(holder) && !text.parentElement?.closest('[data-ellipsis]') && text.data.length > 0) {
        pieces.push({ node: text, start: Number(holder.getAttribute('data-offset')), length: text.data.length })
      }
      node = walker.nextNode()
    }
    const locate = (offset: number): { node: Text; offset: number } => {
      for (const piece of pieces) {
        if (offset >= piece.start && offset <= piece.start + piece.length) {
          return { node: piece.node, offset: offset - piece.start }
        }
      }
      throw new Error(`Offset ${offset} is outside the text`)
    }
    const anchor = locate(offsets.start)
    const focus = locate(offsets.end)
    const range = document.createRange()
    range.setStart(anchor.node, anchor.offset)
    range.setEnd(focus.node, focus.offset)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, { start, end })
}

async function keepPhrase(page: Page, wrapper: Locator, start: number, end: number): Promise<void> {
  const kept = wrapper.locator('xpath=ancestor::*[@data-ai-comment][1]').locator('[data-kept-range]').first()
  if (await kept.count() > 0) await kept.hover()
  else await wrapper.hover()
  await selectOffsets(page, wrapper, start, end)
  await page.locator('[data-keep-pin]').click()
}

function savedRanges(userData: string): { comment: string; replies: string[] } {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT keptRanges FROM aiComments').get() as { keptRanges: string }
  const replies = db.prepare('SELECT keptRanges FROM aiReplies ORDER BY createdAt, rowid').all() as {
    keptRanges: string
  }[]
  db.close()
  return { comment: row.keptRanges, replies: replies.map((reply) => reply.keptRanges) }
}

test('keeping a phrase hides the rest; hover reveals it and moving away collapses it', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const wrapper = commentWrapper(page)
    await expect(wrapper).toHaveCount(1)
    await keepPhrase(page, wrapper, 5, 9)

    await expect(wrapper).toHaveAttribute('data-keep-state', 'kept')
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('does')
    await expect(wrapper.locator('.sr-only')).toHaveCount(2)
    const highlight = await wrapper.locator('[data-kept-range]').evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--ai-soft)'
      document.body.appendChild(probe)
      const soft = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { kept: getComputedStyle(element).backgroundColor, soft }
    })
    expect(highlight.kept).toBe(highlight.soft)

    await wrapper.locator('[data-kept-range]').first().hover()
    await expect(wrapper).toHaveAttribute('data-keep-state', 'full')
    await expect(wrapper).toContainText(COMMENT_TEXT)
    await expect(wrapper.locator('.sr-only')).toHaveCount(0)
    await page.mouse.move(5, 5)
    await expect(wrapper).toHaveAttribute('data-keep-state', 'kept')
    await expect(page.locator('[data-task-text]').first()).toHaveText(TASK_TEXT)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('two kept ranges show an ellipsis, and a selection across them merges into one', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const wrapper = commentWrapper(page)
    await expect(wrapper).toHaveCount(1)
    await keepPhrase(page, wrapper, 5, 9)
    await keepPhrase(page, wrapper, 10, 14)
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(2)
    await expect(wrapper.locator('[data-keep-ellipsis]')).toHaveCount(1)

    await wrapper.locator('[data-kept-range]').first().hover()
    await selectOffsets(page, wrapper, 6, 12)
    await page.locator('[data-keep-pin]').click()
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(1)
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('does done')
    await expect(wrapper.locator('[data-keep-ellipsis]')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('clicking a kept range shows Remove, and removing it brings the full text back', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const wrapper = commentWrapper(page)
    await expect(wrapper).toHaveCount(1)
    await keepPhrase(page, wrapper, 5, 9)
    await wrapper.locator('[data-kept-range]').first().hover()
    await wrapper.locator('[data-kept-range]').click()
    await page.locator('[data-remove-label]').click()
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(0)
    await expect(wrapper).toHaveAttribute('data-keep-state', 'full')
    await page.waitForTimeout(400)
    expect(savedRanges(userData).comment).toBe('[]')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('kept ranges survive a restart', async () => {
  const mock = await startMockLmStudio()
  let { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const wrapper = commentWrapper(page)
    await expect(wrapper).toHaveCount(1)
    await keepPhrase(page, wrapper, 5, 9)
    await page.waitForTimeout(400)
    expect(savedRanges(userData).comment).toBe('[[5,9]]')
    await test.step('Close the first Electron instance', () => app.close())
    const next = await test.step('Relaunch the saved profile', () => launchApp(userData))
    app = next.app
    page = next.page
    const restored = commentWrapper(page)
    await expect(restored).toHaveAttribute('data-keep-state', 'kept')
    await expect(restored.locator('[data-kept-range]')).toHaveText('does')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('each reply keeps its own ranges, separate from the comment', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    await expect(commentWrapper(page)).toHaveCount(1)
    mock.setChatMode('reply')
    await page.getByRole('textbox', { name: 'Write back' }).fill('Done means sent to the team.')
    await page.getByRole('button', { name: 'Send reply' }).click()
    const thread = page.locator('[data-ai-replies]')
    await expect(thread).toBeVisible()
    const aiReply = thread.locator('[data-keep-text]').nth(1)
    await keepPhrase(page, aiReply, 2, 9)
    await expect(aiReply.locator('[data-kept-range]')).toHaveText('smaller')
    await expect(commentWrapper(page).locator('[data-kept-range]')).toHaveCount(0)
    await expect(thread.locator('[data-keep-text]').nth(0).locator('[data-kept-range]')).toHaveCount(0)
    await page.waitForTimeout(400)
    const saved = savedRanges(userData)
    expect(saved.comment).toBe('[]')
    expect(saved.replies).toEqual(['[]', '[[2,9]]'])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('each keep and each remove is one undo step', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const wrapper = commentWrapper(page)
    await expect(wrapper).toHaveCount(1)
    await keepPhrase(page, wrapper, 5, 9)
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('does')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('does')

    await wrapper.locator('[data-kept-range]').first().hover()
    await wrapper.locator('[data-kept-range]').click()
    await page.locator('[data-remove-label]').click()
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('does')
    await page.waitForTimeout(400)
    expect(savedRanges(userData).comment).toBe('[[5,9]]')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('the keyboard route keeps a selection with Enter and removes a range', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const wrapper = commentWrapper(page)
    await expect(wrapper).toHaveCount(1)
    await wrapper.focus()
    await selectOffsets(page, wrapper, 5, 9)
    const pin = page.locator('[data-keep-pin]')
    await expect(pin).toBeVisible()
    await expect(wrapper).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('does')
    await wrapper.locator('[data-kept-range]').focus()
    await selectOffsets(page, wrapper, 9, 14)
    await expect(pin).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('does done')

    await wrapper.locator('[data-kept-range]').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-remove-label]')).toBeVisible()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('delete still removes everything, and undo restores the kept ranges too', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const wrapper = commentWrapper(page)
    await expect(wrapper).toHaveCount(1)
    await keepPhrase(page, wrapper, 5, 9)
    const node = page.locator('.react-flow__node-aiComment')
    await wrapper.locator('[data-kept-range]').first().hover()
    await node.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(commentWrapper(page).locator('[data-kept-range]')).toHaveText('does')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})