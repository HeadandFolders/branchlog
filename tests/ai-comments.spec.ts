import { expect, test } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'
import { addMainTask, chatPosts, enableAi } from './ai-helpers'
import { startMockLmStudio } from './mock-lm-studio'

const TASK_TEXT = 'ship the quarterly report'
const COMMENT_TEXT = 'What does done look like for this?'

test('a paused task earns one comment on the left, in the AI tokens, with an arrow', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    const task = await writeTask(page, TASK_TEXT)
    const comment = page.locator('[data-ai-comment]')
    await expect(comment).toHaveCount(1)
    await expect(page.locator('[data-ai-text]')).toHaveText(COMMENT_TEXT)
    await expect(page.locator('.react-flow__edge.ai-edge')).toHaveCount(1)
    await expect(page.locator('[data-ai-thinking]')).toHaveCount(0)
    expect(chatPosts(mock)).toHaveLength(1)

    const taskBox = await task.boundingBox()
    const commentBox = await comment.boundingBox()
    expect(taskBox).not.toBeNull()
    expect(commentBox).not.toBeNull()
    expect(commentBox!.x + commentBox!.width).toBeLessThanOrEqual(taskBox!.x)

    const style = await page.locator('[data-ai-text]').evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--ai)'
      document.body.appendChild(probe)
      const ai = getComputedStyle(probe).color
      probe.remove()
      const computed = getComputedStyle(element.parentElement!)
      return { color: getComputedStyle(element).color, ai, font: computed.fontFamily, align: computed.textAlign }
    })
    expect(style.color).toBe(style.ai)
    expect(style.font.toLowerCase()).toContain('newsreader')
    expect(style.align).toBe('right')
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('thinking dots show while the model is slow and never shift the task line', async () => {
  const mock = await startMockLmStudio({ chatMode: 'delayed', delayMs: 2500 })
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    const task = await writeTask(page, TASK_TEXT)
    await expect(page.locator('[data-ai-thinking]')).toBeVisible()
    const before = await task.boundingBox()
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    await expect(page.locator('[data-ai-thinking]')).toHaveCount(0)
    const after = await task.boundingBox()
    expect(after).toEqual(before)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('null and malformed answers leave the page untouched', async () => {
  const mock = await startMockLmStudio({ chatMode: 'null' })
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    await expect.poll(() => chatPosts(mock).length).toBe(1)
    await page.waitForTimeout(600)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)

    mock.setChatMode('malformed')
    await addMainTask(page, 'a second task worth commenting on')
    await expect.poll(() => chatPosts(mock).length).toBe(2)
    await page.waitForTimeout(600)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('[data-ai-status]')).toHaveCount(0)
    await expect(page.locator('[data-task-text]').first()).toHaveText(TASK_TEXT)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a reply thread grows, collapses, and the comment resolves to a reopenable dot', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const node = page.locator('.react-flow__node-aiComment')
    await expect(node).toHaveCount(1)
    mock.setChatMode('reply')
    await page.getByRole('textbox', { name: 'Write back' }).fill('Done means sent to the team.')
    await page.getByRole('button', { name: 'Send reply' }).click()
    const thread = page.locator('[data-ai-replies]')
    await expect(thread).toContainText('Done means sent to the team.')
    await expect(thread).toContainText('A smaller first step still counts.')
    await expect(page.getByRole('button', { name: '2 replies' })).toBeVisible()
    await page.getByRole('button', { name: '2 replies' }).click()
    await expect(thread).toHaveCount(0)
    await page.getByRole('button', { name: '2 replies' }).click()
    await expect(thread).toBeVisible()

    await node.hover()
    await page.getByRole('button', { name: 'Resolve comment' }).click()
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    const dot = page.getByRole('button', { name: 'Reopen AI comment' })
    await expect(dot).toBeVisible()
    await dot.click()
    await expect(page.locator('[data-ai-text]')).toHaveText(COMMENT_TEXT)
    await node.hover()
    await expect(page.getByRole('button', { name: '2 replies' })).toBeVisible()
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('delete removes the comment and its arrow; undo and redo walk it back', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const node = page.locator('.react-flow__node-aiComment')
    await expect(node).toHaveCount(1)
    await node.hover()
    await node.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    await expect(page.locator('.react-flow__edge.ai-edge')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('[data-ai-text]')).toHaveText(COMMENT_TEXT)
    await expect(page.locator('.react-flow__edge.ai-edge')).toHaveCount(1)
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    await expect(page.locator('[data-task-text]').first()).toHaveText(TASK_TEXT)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a dragged comment keeps its place across a restart', async () => {
  const mock = await startMockLmStudio()
  let { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK_TEXT)
    const node = page.locator('.react-flow__node-aiComment')
    await expect(node).toHaveCount(1)
    const original = await node.evaluate((element) => element.style.transform)
    const box = await node.locator('[data-ai-comment]').boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + 1, box!.y + 1)
    await page.mouse.down()
    await page.mouse.move(box!.x - 39, box!.y + 51, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const moved = await node.evaluate((element) => element.style.transform)
    expect(moved).not.toBe(original)
    await closeApp(app, userData, true)
    const next = await launchApp(userData)
    app = next.app
    page = next.page
    await expect(page.locator('[data-ai-text]')).toHaveText(COMMENT_TEXT)
    await expect(page.locator('.react-flow__node-aiComment')).toHaveCount(1)
    const restored = await page.locator('.react-flow__node-aiComment').evaluate((element) => element.style.transform)
    expect(restored).toBe(moved)
    expect(chatPosts(mock)).toHaveLength(1)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('the daily cap stops a second comment without a second request', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url, { maxComments: 1 })
    await writeTask(page, TASK_TEXT)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    await addMainTask(page, 'a second task worth commenting on')
    await page.waitForTimeout(1500)
    expect(chatPosts(mock)).toHaveLength(1)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('deleting the task takes its comment; undo brings both back', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    const task = await writeTask(page, TASK_TEXT)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    await task.click()
    await task.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('[data-task-text]')).toHaveCount(1)
    await expect(page.locator('[data-ai-text]')).toHaveText(COMMENT_TEXT)
    await expect(page.locator('.react-flow__edge.ai-edge')).toHaveCount(1)
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('an unreachable server shows one quiet note, never an alert', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await mock.close()
    const task = await writeTask(page, TASK_TEXT)
    await expect(page.locator('[data-ai-status]')).toContainText('AI is offline')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(0)
    await expect(task).toHaveText(TASK_TEXT)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})