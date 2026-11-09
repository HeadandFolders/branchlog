import { expect, test } from '@playwright/test'
import { closeApp, launchApp } from './launch'
import { chatPosts, enableAi } from './ai-helpers'
import { startMockLmStudio } from './mock-lm-studio'

test('typing through a slow answer keeps every character and comments only the final text', async () => {
  const mock = await startMockLmStudio({ chatMode: 'delayed', delayMs: 4000 })
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    const input = page.getByRole('textbox', { name: 'New task' })
    await input.click()
    await page.keyboard.type('write the launch plan', { delay: 10 })
    await expect(page.locator('[data-ai-thinking]')).toBeVisible()
    await page.keyboard.type(' for monday morning', { delay: 5 })
    const task = page.locator('[data-task-text]').first()
    const finalText = 'write the launch plan for monday morning'
    await expect(task).toHaveText(finalText)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('[data-ai-text]')).toHaveText('What does done look like for this?')
    await expect(task).toHaveText(finalText)

    const posts = chatPosts(mock)
    expect(posts.length).toBeGreaterThanOrEqual(2)
    const last = posts[posts.length - 1].body as { messages?: { role: string; content: string }[] }
    const user = last.messages?.find((message) => message.role === 'user')
    expect(user?.content).toContain(`Current task: ${finalText}`)

    await task.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect(task).toHaveText(`${finalText}!`)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('checking the task done while the model thinks produces no comment', async () => {
  const mock = await startMockLmStudio({ chatMode: 'delayed', delayMs: 2500 })
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await page.getByRole('textbox', { name: 'New task' }).click()
    await page.keyboard.type('ship the quarterly report')
    await expect(page.locator('[data-ai-thinking]')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Mark task done' }).first().click()
    await page.waitForTimeout(3200)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    await expect(page.locator('[data-ai-thinking]')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})