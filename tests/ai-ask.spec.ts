import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { closeApp, launchApp, modifier } from './launch'
import { chatPosts } from './ai-helpers'
import { askBranch, BRANCH_TEXT, keepAnswer, PARENT_TEXT, prepareAsk } from './ai-ask-helpers'
import { MOCK_ANSWER, startMockLmStudio, type MockChatMode } from './mock-lm-studio'

function savedComments(userData: string) {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const comments = db.prepare('SELECT * FROM aiComments ORDER BY rowid').all()
  const replies = db.prepare('SELECT * FROM aiReplies ORDER BY rowid').all()
  db.close()
  return { comments, replies }
}

test('Ask AI answers inside the branch, uses lineage and day context, and never changes task text', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    await askBranch(branch)
    const answer = branch.locator('[data-ai-answer]')
    await expect(answer).toHaveCount(1)
    await expect(answer.locator('[data-ai-text]')).toHaveText(MOCK_ANSWER)
    await expect(branch.locator('[data-task-text]')).toHaveText(BRANCH_TEXT)
    await expect(page.locator('[data-task-text]').first()).toHaveText(PARENT_TEXT)
    await expect(page.locator('.react-flow__node-aiComment')).toHaveCount(0)
    const posts = chatPosts(mock)
    expect(posts).toHaveLength(1)
    const messages = posts[0].body?.messages as { role: string; content: string }[]
    expect(messages[0].content).toContain('Never')
    expect(messages[0].content).toContain('answer')
    expect(messages[1].content).toContain(`Earlier line 1: ${PARENT_TEXT}`)
    expect(messages[1].content).toContain(`Current task: ${BRANCH_TEXT}`)
    expect(messages[1].content).toContain(`- ${PARENT_TEXT}`)
    expect(posts[0].body?.stream).toBe(false)
    const painted = await answer.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--ai)'
      probe.style.fontFamily = 'var(--font-serif)'
      document.body.appendChild(probe)
      const actual = getComputedStyle(element)
      const expected = getComputedStyle(probe)
      const result = { color: actual.color === expected.color, font: actual.fontFamily === expected.fontFamily }
      probe.remove()
      return result
    })
    expect(painted).toEqual({ color: true, font: true })
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('a kept answer reveals on hover and keep, delete, and explicit creation are undoable', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    await askBranch(branch)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await keepAnswer(page, branch)
    const wrapper = branch.locator('[data-ai-text] [data-keep-text]')
    await wrapper.hover()
    await expect(wrapper).toHaveAttribute('data-keep-state', 'full')
    await expect(wrapper).toHaveText(MOCK_ANSWER)
    await page.mouse.move(5, 5)
    await page.keyboard.press(`${modifier}+z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Shift+z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('Start with an outline')
    await branch.locator('[data-ai-answer]').hover()
    await branch.locator('[data-ai-answer]').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('Start with an outline')
    await page.keyboard.press(`${modifier}+z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+z`)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(0)
    await expect(branch.locator('[data-task-text]')).toHaveText(BRANCH_TEXT)
    await page.keyboard.press(`${modifier}+Shift+z`)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('reply pairs are undoable and answer deletion restores replies and ranges exactly', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    await askBranch(branch)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await keepAnswer(page, branch)
    mock.setChatMode('reply')
    const answer = branch.locator('[data-ai-answer]')
    await answer.getByRole('textbox', { name: 'Write back' }).fill('What belongs in the outline?')
    await answer.getByRole('button', { name: 'Send reply' }).click()
    await expect(answer.locator('[data-ai-replies]')).toContainText('A smaller first step still counts.')
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press(`${modifier}+z`)
    await expect(answer.locator('[data-ai-replies]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Shift+z`)
    await expect(answer.locator('[data-ai-replies]')).toContainText('What belongs in the outline?')
    const before = savedComments(userData)
    await answer.hover()
    await answer.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(answer).toHaveCount(0)
    expect(savedComments(userData)).toEqual({ comments: [], replies: [] })
    await page.keyboard.press(`${modifier}+z`)
    await expect(answer).toHaveCount(1)
    expect(savedComments(userData)).toEqual(before)
    await expect(answer.locator('[data-kept-range]')).toHaveText('Start with an outline')
    await expect(branch.locator('[data-task-text]')).toHaveText(BRANCH_TEXT)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('keeping answer and reply text during another reply preserves the ranges through undo', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    await askBranch(branch)
    const answer = branch.locator('[data-ai-answer]')
    await expect(answer).toHaveCount(1)
    mock.setChatMode('reply')
    mock.holdChatResponses()
    await answer.getByRole('textbox', { name: 'Write back' }).fill('Give one detail.')
    await answer.getByRole('button', { name: 'Send reply' }).click()
    await expect.poll(() => chatPosts(mock).length).toBe(2)
    await keepAnswer(page, branch)
    mock.releaseChatResponses()
    await expect(answer.locator('[data-ai-replies]')).toContainText('A smaller first step still counts.')
    await expect(answer.locator('[data-ai-text] [data-kept-range]')).toHaveText('Start with an outline')

    mock.holdChatResponses()
    await answer.getByRole('textbox', { name: 'Write back' }).fill('And one more?')
    await answer.getByRole('button', { name: 'Send reply' }).click()
    await expect.poll(() => chatPosts(mock).length).toBe(3)
    const reply = answer.locator('[data-ai-replies] [data-keep-text]').nth(1)
    await reply.hover()
    await reply.evaluate((element) => {
      const node = element.querySelector('[data-offset="0"]')?.firstChild
      if (!node) throw new Error('Missing reply text')
      const range = document.createRange()
      range.setStart(node, 2)
      range.setEnd(node, 9)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await page.locator('[data-keep-label]').click()
    mock.releaseChatResponses()
    await expect(answer.getByRole('button', { name: '4 replies' })).toBeVisible()
    await expect(reply.locator('[data-kept-range]')).toHaveText('smaller')
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press(`${modifier}+z`)
    await expect(answer.getByRole('button', { name: '2 replies' })).toBeVisible()
    await expect(reply.locator('[data-kept-range]')).toHaveText('smaller')
    await expect(answer.locator('[data-ai-text] [data-kept-range]')).toHaveText('Start with an outline')
    const before = savedComments(userData)
    await page.keyboard.press(`${modifier}+Shift+z`)
    await expect(answer.getByRole('button', { name: '4 replies' })).toBeVisible()
    await page.keyboard.press(`${modifier}+z`)
    expect(savedComments(userData)).toEqual(before)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('restart preserves the answer, replies and kept ranges and task deletion cascades with undo', async () => {
  const mock = await startMockLmStudio()
  const launched = await launchApp()
  let { app, page } = launched
  const { userData } = launched
  try {
    let branch = await prepareAsk(page, mock.url)
    await askBranch(branch)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await keepAnswer(page, branch)
    mock.setChatMode('reply')
    await branch.getByRole('textbox', { name: 'Write back' }).fill('Give one detail.')
    await branch.getByRole('button', { name: 'Send reply' }).click()
    await expect(branch.locator('[data-ai-replies]')).toBeVisible()
    await expect.poll(() => savedComments(userData).replies.length).toBe(2)
    const before = savedComments(userData)
    await app.close()
    const next = await launchApp(userData)
    app = next.app
    page = next.page
    branch = page.locator('.react-flow__node-branch').first()
    await expect(branch.locator('[data-task-text]')).toHaveText(BRANCH_TEXT)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await expect(branch.locator('[data-kept-range]')).toHaveText('Start with an outline')
    expect(savedComments(userData)).toEqual(before)
    await branch.locator('[data-ai-answer]').hover()
    await expect(branch.locator('.ai-comment-tools')).toHaveCSS('pointer-events', 'auto')
    await branch.getByRole('button', { name: '2 replies' }).click()
    await expect(branch.locator('[data-ai-replies]')).toContainText('Give one detail.')
    await branch.hover()
    await branch.locator('.branch-delete').click()
    await expect(branch).toHaveCount(0)
    expect(savedComments(userData)).toEqual({ comments: [], replies: [] })
    await page.keyboard.press(`${modifier}+z`)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    expect(savedComments(userData)).toEqual(before)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

for (const mode of ['null', 'malformed', 'error500'] as MockChatMode[]) {
  test(`${mode} answers give a quiet note without adding a block`, async () => {
    const mock = await startMockLmStudio({ chatMode: mode })
    const { app, page, userData } = await launchApp()
    try {
      const branch = await prepareAsk(page, mock.url)
      await askBranch(branch)
      await expect(branch.locator('[data-ai-answer-note]')).toHaveText(mode === 'error500' ? 'LM Studio is offline.' : 'No answer this time.')
      await expect(branch.locator('[data-ai-answer]')).toHaveCount(0)
      await expect(branch.locator('[data-task-text]')).toHaveText(BRANCH_TEXT)
      expect(savedComments(userData).comments).toHaveLength(0)
    } finally {
      await closeApp(app, userData)
      await mock.close()
    }
  })
}

test('explicit answers do not consume the automatic left-margin comment cap', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    await page.keyboard.press(`${modifier}+,`)
    await page.getByRole('spinbutton', { name: 'Max comments per day' }).fill('1')
    await page.keyboard.press('Escape')
    await askBranch(branch)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    const main = page.locator('[data-task-text]').first()
    await main.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' today')
    await expect(page.locator('.react-flow__node-aiComment')).toHaveCount(1)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    expect(chatPosts(mock)).toHaveLength(2)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('right-side edits never send automatic requests and Ask AI is keyboard reachable', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const branch = await prepareAsk(page, mock.url)
    const rejected = await page.evaluate(async () => {
      const mainId = document.querySelector<HTMLElement>('[data-task-text]')?.dataset.taskId ?? ''
      const branchId = document.querySelector<HTMLElement>('.react-flow__node-branch [data-task-text]')?.dataset.taskId ?? ''
      const ask = await window.branchlog.ai.ask({ taskId: mainId, requestId: crypto.randomUUID(), text: 'ship the quarterly report' })
      const automatic = await window.branchlog.ai.requestComment({ taskId: branchId, requestId: crypto.randomUUID(), text: 'How should I start the report?', x: 0, y: 0 })
      return { ask, automatic }
    })
    expect(rejected).toEqual({ ask: { kind: 'none' }, automatic: { kind: 'none' } })
    const text = branch.locator('[data-task-text]')
    await text.click()
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.type(' Include an example.')
    await page.waitForTimeout(1000)
    expect(chatPosts(mock)).toHaveLength(0)
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(0)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const ask = branch.getByRole('button', { name: 'Ask AI', exact: true })
    await expect(ask).toBeFocused()
    await expect(ask).toHaveCSS('opacity', '1')
    await page.keyboard.press('Enter')
    await expect(branch.locator('[data-ai-answer]')).toHaveCount(1)
    await expect(text).toHaveText(`${BRANCH_TEXT} Include an example.`)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})
