import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { AiComment } from '../src/shared/ai-comments'
import type { Task } from '../src/shared/types'
import { buildCanvasNodes } from '../src/renderer/src/lib/canvas-graph'
import { buildCommentEdges } from '../src/renderer/src/lib/canvas-ai'
import { closeApp, launchApp, writeTask } from './launch'
import { addMainTask, chatPosts, enableAi } from './ai-helpers'
import { startMockLmStudio, type MockLmStudio } from './mock-lm-studio'

const TASK = 'ship the quarterly report'
const ORIGINAL = 'What does done look like for this?'
const REPLY = 'A smaller first step still counts.'
const USER_REPLIES = ['Done means sent to the team.', 'What about the final deadline?']

async function selectRange(wrapper: Locator, start: number, end: number): Promise<void> {
  await wrapper.evaluate((element, offsets) => {
    const holders = [...element.querySelectorAll<HTMLElement>('[data-offset]')]
    const locate = (offset: number) => {
      for (const holder of holders) {
        const node = holder.firstChild
        const from = Number(holder.dataset.offset)
        if (node instanceof Text && offset >= from && offset <= from + node.length) {
          return { node, offset: offset - from }
        }
      }
      throw new Error(`Missing selectable offset ${offset}`)
    }
    const anchor = locate(offsets.start)
    const focus = locate(offsets.end)
    const range = document.createRange()
    range.setStart(anchor.node, anchor.offset)
    range.setEnd(focus.node, focus.offset)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }, { start, end })
}

async function pinRange(page: Page, comment: Locator, wrapper: Locator, start: number, end: number): Promise<void> {
  const kept = comment.locator('[data-kept-range]').first()
  if (await kept.count() > 0) await kept.hover()
  else await wrapper.hover()
  await selectRange(wrapper, start, end)
  const pin = page.locator('[data-keep-pin]')
  await expect(pin).toHaveAttribute('aria-label', 'Keep selected text')
  await expect(pin).toHaveAttribute('data-keep-count', '1')
  await pin.click()
  await expect(comment).toHaveAttribute('data-ai-expanded', 'false')
}

async function prepareThread(page: Page, mock: MockLmStudio): Promise<Locator> {
  await enableAi(page, mock.url)
  await writeTask(page, TASK)
  const comment = page.locator('[data-ai-comment]')
  await expect(comment.locator('[data-ai-text]')).toHaveText(ORIGINAL)
  mock.setChatMode('reply')
  for (const [index, text] of USER_REPLIES.entries()) {
    await comment.getByRole('textbox', { name: 'Write back' }).fill(text)
    await comment.getByRole('button', { name: 'Send reply' }).click()
    await expect(comment.locator('.ai-reply')).toHaveCount((index + 1) * 2)
  }
  return comment
}

async function expectClipped(locator: Locator): Promise<void> {
  // sr-only text is still accessible: visibility assertions do not prove trimming.
  await expect(locator).toHaveClass(/\bsr-only\b/)
  await expect(locator).toHaveCSS('position', 'absolute')
  await expect(locator).toHaveCSS('clip-path', 'inset(50%)')
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBe(1)
  expect(box!.height).toBe(1)
}

async function expectFullThread(comment: Locator): Promise<void> {
  await expect(comment).toHaveAttribute('data-ai-expanded', 'true')
  await expect(comment.locator('[data-ai-text]')).toHaveText(ORIGINAL)
  await expect(comment.locator('.ai-reply [data-keep-text]')).toHaveText([
    USER_REPLIES[0], REPLY, USER_REPLIES[1], REPLY,
  ])
  for (const message of await comment.locator('[data-ai-text], .ai-reply').all()) await expect(message).not.toHaveClass(/\bsr-only\b/)
  await expect(comment.locator('[data-offset].sr-only')).toHaveCount(0)
  expect(await comment.locator('[data-kept-range]').evaluateAll((marks) => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = 'var(--ai-soft)'
    document.body.appendChild(probe)
    const soft = getComputedStyle(probe).backgroundColor
    probe.remove()
    return marks.length > 0 && marks.every((mark) => getComputedStyle(mark).backgroundColor === soft)
  })).toBe(true)
  await expect(comment.locator('.ai-reply-role')).toHaveText(['You', 'AI', 'You', 'AI'])
  for (const role of await comment.locator('.ai-reply-role').all()) await expect(role).toBeVisible()
  await expect(comment.getByRole('textbox', { name: 'Write back' })).toBeVisible()
  await expect(comment.locator('.ai-comment-tools')).toHaveCSS('pointer-events', 'auto')
}

async function expectIdleControls(comment: Locator): Promise<void> {
  await expect(comment).toHaveAttribute('data-ai-expanded', 'false')
  await expect(comment.locator('.ai-reply-form')).toBeHidden()
  await expect(comment.locator('.ai-comment-tools')).toBeHidden()
  for (const role of await comment.locator('.ai-reply-role').all()) await expect(role).toBeHidden()
  await expect(comment.locator('.ai-reply')).toHaveCount(4)
}

test('idle shows only kept excerpts from the whole thread; hovering either mark reveals every message', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const comment = await prepareThread(page, mock)
    const original = comment.locator('[data-ai-text] [data-keep-text]')
    const reply = comment.locator('.ai-reply [data-keep-text]').nth(3)
    await pinRange(page, comment, original, 5, 9)
    await pinRange(page, comment, reply, 2, 9)
    await expectIdleControls(comment)
    await expect(comment.locator('[data-kept-range]')).toHaveText(['does', 'smaller'])
    await expect(original).toHaveText(ORIGINAL)
    await expect(reply).toHaveText(REPLY)
    for (const wrapper of [original, reply]) {
      await expect(wrapper.locator('[data-offset].sr-only')).toHaveCount(2)
      for (const gap of await wrapper.locator('[data-offset].sr-only').all()) await expectClipped(gap)
    }
    for (const index of [0, 1, 2]) await expectClipped(comment.locator('.ai-reply').nth(index))
    for (const mark of await comment.locator('[data-kept-range]').all()) {
      await mark.hover()
      await expectFullThread(comment)
      await expect(comment.locator('[data-kept-range]')).toHaveText(['does', 'smaller'])
      await page.mouse.move(5, 5)
      await expectIdleControls(comment)
      await expect(original).toHaveAttribute('data-keep-state', 'kept')
      await expect(reply).toHaveAttribute('data-keep-state', 'kept')
    }
    await expect(page.locator('[data-task-text]')).toHaveText(TASK)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('keeping only a reply clips the original and unkept replies without unmounting the thread', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const comment = await prepareThread(page, mock)
    const reply = comment.locator('.ai-reply [data-keep-text]').nth(1)
    const messages = await comment.locator('[data-ai-text], .ai-reply').elementHandles()
    await pinRange(page, comment, reply, 2, 9)
    await expectIdleControls(comment)
    await expect(comment.locator('[data-kept-range]')).toHaveText('smaller')
    await expectClipped(comment.locator('[data-ai-text]'))
    await expect(comment.locator('[data-ai-text]')).toHaveText(ORIGINAL)
    for (const index of [0, 2, 3]) await expectClipped(comment.locator('.ai-reply').nth(index))
    await reply.locator('[data-kept-range]').hover()
    await expectFullThread(comment)
    await expect(comment.getByRole('button', { name: '4 replies' })).toHaveCount(0)
    await expect(comment.locator('.ai-reply')).toHaveCount(4)
    expect(await page.evaluate((nodes) => nodes.every((node) => node?.isConnected), messages)).toBe(true)
    await page.mouse.move(5, 5)
    await expectIdleControls(comment)
    await expectClipped(comment.locator('[data-ai-text]'))
    for (const index of [0, 2, 3]) await expectClipped(comment.locator('.ai-reply').nth(index))
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('keyboard focus reveals the whole chat and Enter on the toolbar pin commits and immediately trims it', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const comment = await prepareThread(page, mock)
    const original = comment.locator('[data-ai-text] [data-keep-text]')
    await pinRange(page, comment, original, 5, 9)
    await page.keyboard.press('Tab')
    const mark = original.locator('[data-kept-range]')
    await mark.focus()
    await expect(mark).toBeFocused()
    await expectFullThread(comment)
    const reply = comment.locator('.ai-reply [data-keep-text]').nth(1)
    await selectRange(reply, 2, 9)
    const pin = page.locator('[data-keep-pin]')
    await expect(pin).toHaveAttribute('aria-label', 'Keep selected text')
    await pin.focus()
    await expect(pin).toBeFocused()
    await expect(comment).toHaveAttribute('data-ai-expanded', 'true')
    await page.keyboard.press('Enter')
    await expectIdleControls(comment)
    await expect(comment.locator('[data-kept-range]')).toHaveText(['does', 'smaller'])
    await expect(page.locator('[data-keep-pin], [data-keep-label]')).toHaveCount(0)
    await mark.focus()
    await expectFullThread(comment)
    await page.locator('[data-task-text]').focus()
    await expectIdleControls(comment)
    await expect(page.locator('[data-task-text]')).toHaveText(TASK)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

function savedComment(userData: string, taskId: string): Pick<AiComment, 'id' | 'taskId' | 'status' | 'x' | 'y'> {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  try {
    db.pragma('busy_timeout = 3000')
    return db.prepare('SELECT id, taskId, status, x, y FROM aiComments WHERE taskId = ?').get(taskId) as ReturnType<typeof savedComment>
  } finally {
    db.close()
  }
}

test('resolved dots belong beside the exact checkbox without shifting text; reopen restores saved position after restart', async () => {
  const mock = await startMockLmStudio()
  let { app, page, userData } = await launchApp()
  try {
    await enableAi(page, mock.url)
    await writeTask(page, TASK)
    await expect(page.locator('[data-ai-comment]')).toHaveCount(1)
    await addMainTask(page, 'send the meeting notes')
    await expect(page.locator('[data-ai-comment]')).toHaveCount(2)
    let task = page.locator('[data-task-text]').nth(1)
    const taskId = (await task.getAttribute('data-task-id'))!
    const initial = savedComment(userData, taskId)
    let node = page.locator(`.react-flow__node-aiComment[data-id="${initial.id}"]`)
    const originalTransform = await node.evaluate((element) => element.style.transform)
    const box = (await node.locator('[data-ai-comment]').boundingBox())!
    await page.mouse.move(box.x + 1, box.y + 1)
    await page.mouse.down()
    await page.mouse.move(box.x - 39, box.y + 51, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => savedComment(userData, taskId)).not.toEqual(initial)
    const moved = savedComment(userData, taskId)
    const movedTransform = await node.evaluate((element) => element.style.transform)
    expect(movedTransform).not.toBe(originalTransform)
    const textBounds = await page.locator('[data-task-text]').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
    await node.hover()
    await node.getByRole('button', { name: 'Resolve comment' }).click()
    const dot = page.locator(`[data-ai-resolved="${initial.id}"]`)
    await expect(dot).toBeVisible()
    const firstId = (await page.locator('[data-task-text]').first().getAttribute('data-task-id'))!
    const line = page.locator('.task-line').filter({ has: page.locator(`[data-task-id="${taskId}"]`) })
    await expect(line.locator('[data-ai-resolved]')).toHaveCount(1)
    await expect(page.locator('.task-line').filter({ has: page.locator(`[data-task-id="${firstId}"]`) }).locator('[data-ai-resolved]')).toHaveCount(0)
    expect(await dot.evaluate((element) => element.closest('.task-line')?.querySelector<HTMLElement>('[data-task-text]')?.dataset.taskId)).toBe(taskId)
    const dotBox = (await dot.boundingBox())!
    const checkBox = (await line.getByRole('checkbox').boundingBox())!
    expect(checkBox.x - dotBox.x - dotBox.width).toBeGreaterThanOrEqual(0)
    expect(checkBox.x - dotBox.x - dotBox.width).toBeLessThanOrEqual(16)
    expect(Math.abs(dotBox.y + dotBox.height / 2 - checkBox.y - checkBox.height / 2)).toBeLessThan(8)
    expect(await page.locator('[data-task-text]').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))).toEqual(textBounds)
    await expect(node).toHaveCount(0)
    await expect(page.locator(`[data-ai-comment="${initial.id}"]`)).toHaveCount(0)
    await expect(page.locator(`.react-flow__edge[data-id="edge-ai-${initial.id}"]`)).toHaveCount(0)
    expect(savedComment(userData, taskId)).toEqual({ ...moved, status: 'resolved' })
    await closeApp(app, userData, true)
    const next = await launchApp(userData)
    app = next.app
    page = next.page
    task = page.locator(`[data-task-id="${taskId}"]`)
    node = page.locator(`.react-flow__node-aiComment[data-id="${initial.id}"]`)
    const restoredDot = page.locator('.task-line').filter({ has: task }).locator(`[data-ai-resolved="${initial.id}"]`)
    await expect(restoredDot).toBeVisible()
    await expect(node).toHaveCount(0)
    await expect(page.locator(`.react-flow__edge[data-id="edge-ai-${initial.id}"]`)).toHaveCount(0)
    expect(savedComment(userData, taskId)).toEqual({ ...moved, status: 'resolved' })
    const reopenedBounds = await task.boundingBox()
    await restoredDot.click()
    await expect(restoredDot).toHaveCount(0)
    expect(await task.boundingBox()).toEqual(reopenedBounds)
    await expect(node).toHaveCount(1)
    await expect(node.locator('[data-ai-text]')).toHaveText(ORIGINAL)
    await expect(page.locator(`.react-flow__edge[data-id="edge-ai-${initial.id}"]`)).toHaveCount(1)
    expect(await node.evaluate((element) => element.style.transform)).toBe(movedTransform)
    expect(savedComment(userData, taskId)).toEqual(moved)
    await expect(page.locator('[data-task-text]')).toHaveText([TASK, 'send the meeting notes'])
    expect(chatPosts(mock)).toHaveLength(2)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('resolved margin comments never remain as graph nodes or edges, even with a previous open node', () => {
  const task: Task = { id: 'task', text: TASK, done: false, dateCreated: '2026-11-09', dateCompleted: null,
    parentId: null, side: 'main', x: 0, y: 0, width: 0, height: 0, orderIndex: 0, carriedFromId: null, chainId: 'task', droppedAt: null }
  const resolved: AiComment = { id: 'resolved', taskId: task.id, side: 'left', type: 'question', text: ORIGINAL,
    status: 'resolved', keptRanges: '[[5,9]]', x: -321, y: 87, createdAt: '2026-11-09T10:00:00.000Z', replies: [] }
  const open = { ...resolved, id: 'open', status: 'open' as const }
  const previous = buildCanvasNodes([task], [], [], [{ ...resolved, status: 'open' }])
  expect(buildCanvasNodes([task], [], previous, [resolved, open]).map((node) => node.id)).toEqual(['main-list', 'open'])
  expect(buildCommentEdges([resolved, open], [task]).map((edge) => edge.source)).toEqual(['open'])
  const reopened = buildCanvasNodes([task], [], [], [{ ...resolved, status: 'open' }]).find((node) => node.id === resolved.id)
  expect(reopened?.position).toEqual({ x: -321, y: 87 })
})
