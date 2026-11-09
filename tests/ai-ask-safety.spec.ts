import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { closeApp, launchApp, modifier } from './launch'
import { chatPosts } from './ai-helpers'
import { askBranch, BRANCH_TEXT, prepareAsk } from './ai-ask-helpers'
import { MOCK_ANSWER, startMockLmStudio } from './mock-lm-studio'

test('an answer arriving during branch typing preserves every character, the field and the caret', async () => {
  const mock = await startMockLmStudio({ chatMode: 'delayed', delayMs: 800 })
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    const text = branch.locator('[data-task-text]')
    await text.click()
    await page.keyboard.press(`${modifier}+End`)
    const field = await text.elementHandle()
    await askBranch(branch)
    await expect(branch.locator('[data-ai-asking]')).toBeVisible()
    await expect(text).toBeFocused()
    await page.keyboard.type(' Please include three concrete examples.', { delay: 45 })
    await expect(branch.locator('[data-ai-text]')).toHaveText(MOCK_ANSWER)
    await expect(text).toHaveText(`${BRANCH_TEXT} Please include three concrete examples.`)
    await expect(text).toBeFocused()
    expect(await text.evaluate((element, original) => element === original, field)).toBe(true)
    await page.keyboard.type('!')
    await expect(text).toHaveText(`${BRANCH_TEXT} Please include three concrete examples.!`)
    const posts = chatPosts(mock)
    expect(posts).toHaveLength(1)
    const messages = posts[0].body?.messages as { role: string; content: string }[]
    expect(messages[1].content).toContain(`Current task: ${BRANCH_TEXT}`)
    expect(messages[1].content).not.toContain('three concrete examples')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('cancelling a pending answer aborts it without an offline note or a late block', async () => {
  const mock = await startMockLmStudio({ chatMode: 'delayed', delayMs: 1200 })
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    await askBranch(branch)
    await expect.poll(() => chatPosts(mock).length).toBe(1)
    await branch.getByRole('button', { name: 'Cancel AI answer' }).click()
    await expect(branch.locator('[data-ai-asking]')).toHaveCount(0)
    await page.waitForTimeout(1500)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(0)
    await expect(branch.locator('[data-ai-answer-note]')).toHaveCount(0)
    await expect(page.getByText('LM Studio is offline.', { exact: true })).toHaveCount(0)
    await expect(branch.locator('[data-task-text]')).toHaveText(BRANCH_TEXT)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a newer explicit ask cancels the previous ask and only the newer branch gets an answer', async () => {
  const mock = await startMockLmStudio({ chatMode: 'delayed', delayMs: 1200 })
  const { app, page, userData } = await launchApp()
  try {
    const first = await prepareAsk(page, mock.url)
    await page.getByRole('button', { name: 'Branch from this task' }).first().click()
    await page.keyboard.type('How do I finish the report?')
    const second = page.locator('.react-flow__node-branch').last()
    await askBranch(first)
    await expect.poll(() => chatPosts(mock).length).toBe(1)
    mock.setChatMode('json')
    await askBranch(second)
    await expect(second.locator('[data-ai-answer]')).toHaveCount(1)
    await page.waitForTimeout(1500)
    await expect(first.locator('[data-ai-answer]')).toHaveCount(0)
    await expect(first.locator('[data-ai-answer-note]')).toHaveCount(0)
    await expect(second.locator('[data-ai-answer]')).toHaveCount(1)
    expect(chatPosts(mock)).toHaveLength(2)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

for (const action of ['day change', 'task deletion', 'AI off'] as const) {
  test(`${action} cancels a pending answer`, async () => {
    const mock = await startMockLmStudio({ chatMode: 'delayed', delayMs: 1200 })
    const { app, page, userData } = await launchApp()
    try {
      const branch = await prepareAsk(page, mock.url)
      await askBranch(branch)
      await expect.poll(() => chatPosts(mock).length).toBe(1)
      if (action === 'day change') {
        const date = page.locator('.date-input')
        await date.fill('2025-01-02')
        await date.press('Enter')
      } else if (action === 'task deletion') {
        await branch.locator('.branch-delete').click()
      } else {
        await page.keyboard.press(`${modifier}+,`)
        await page.getByRole('checkbox', { name: 'Enable margin comments' }).uncheck()
        await page.keyboard.press('Escape')
      }
      await expect(page.locator('[data-ai-asking]')).toHaveCount(0)
      await page.waitForTimeout(1500)
      await expect(page.locator('[data-ai-answer]')).toHaveCount(0)
      await expect(page.locator('[data-ai-answer-note]')).toHaveCount(0)
      const db = new Database(path.join(userData, 'branchlog.sqlite'))
      const row = db.prepare("SELECT COUNT(*) AS n FROM aiComments WHERE side = 'right'").get() as { n: number }
      db.close()
      expect(row.n).toBe(0)
    } finally {
      await closeApp(app, userData)
      await mock.close()
    }
  })
}
