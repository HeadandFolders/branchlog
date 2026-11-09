import { expect, test } from '@playwright/test'
import { closeApp, launchApp, modifier } from './launch'
import { chatPosts } from './ai-helpers'
import { mouseSelect, prepareComment, savedRanges } from './ai-chat-helpers'
import { startMockLmStudio } from './mock-lm-studio'

test('real mouse selection keeps left-margin text without dragging the comment or canvas', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const wrapper = await prepareComment(page, mock.url)
    const node = page.locator('.react-flow__node-aiComment')
    const viewport = page.locator('.react-flow__viewport')
    const before = await node.evaluate((element) => element.style.transform)
    const viewBefore = await viewport.evaluate((element) => element.style.transform)
    await expect(wrapper).toHaveCSS('cursor', 'text')
    await expect(wrapper).toHaveCSS('user-select', 'text')
    await mouseSelect(page, wrapper, 5, 9)
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('does')
    const pin = page.locator('[data-keep-pin]')
    await expect(pin).toHaveAttribute('aria-label', 'Keep selected text')
    await expect(pin).toHaveAttribute('data-keep-count', '1')
    expect(await pin.evaluate((element) => {
      const tools = element.closest('.ai-comment-tools')
      const axe = tools?.querySelector('[aria-label="Delete"]')
      let slot = element
      while (slot.parentElement && slot.parentElement !== tools) slot = slot.parentElement
      return { sameToolbar: tools !== null && axe?.closest('.ai-comment-tools') === tools,
        beforeAxe: slot.nextElementSibling === axe, insideText: element.closest('[data-keep-text]') !== null }
    })).toEqual({ sameToolbar: true, beforeAxe: true, insideText: false })
    await expect(page.locator('[data-keep-label]')).toHaveCount(0)
    await pin.click()
    // No mouse move: committing from the toolbar must immediately trim the chat.
    await expect(page.locator('[data-ai-comment]')).toHaveAttribute('data-ai-expanded', 'false')
    await expect(wrapper).toHaveAttribute('data-keep-state', 'kept')
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('does')
    await expect(node.locator('.ai-reply-form')).toBeHidden()
    await expect(node.locator('.ai-comment-tools')).toBeHidden()
    await expect(wrapper.locator('.sr-only')).toHaveCount(2)
    for (const gap of await wrapper.locator('.sr-only').all()) {
      expect(await gap.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height, clipPath: getComputedStyle(element).clipPath }
      })).toEqual({ width: 1, height: 1, clipPath: 'inset(50%)' })
    }
    expect(await node.evaluate((element) => element.style.transform)).toBe(before)
    expect(await viewport.evaluate((element) => element.style.transform)).toBe(viewBefore)
    await expect(page.locator('[data-task-text]').first()).toHaveText('ship the quarterly report')
    await expect.poll(() => savedRanges(userData).comments).toEqual(['[[5,9]]'])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('Ctrl-held mouse selections keep multiple phrases as one undoable edit', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const wrapper = await prepareComment(page, mock.url)
    await page.keyboard.down('Control')
    await mouseSelect(page, wrapper, 0, 4)
    await expect(wrapper).toHaveAttribute('data-pending-count', '1')
    await mouseSelect(page, wrapper, 10, 14)
    await expect(wrapper).toHaveAttribute('data-pending-count', '2')
    await expect.poll(() => page.evaluate(() => CSS.highlights.get('ai-pending-keep')?.size)).toBe(2)
    expect(savedRanges(userData).comments).toEqual(['[]'])
    await page.keyboard.up('Control')
    await expect(page.locator('[data-keep-pin]')).toHaveAttribute('data-keep-count', '2')
    await page.locator('[data-keep-pin]').click()
    await page.mouse.move(5, 5)
    await expect(wrapper.locator('[data-kept-range]')).toHaveText(['What', 'done'])
    await expect(wrapper.locator('[data-keep-ellipsis]')).toHaveCount(1)
    await expect.poll(() => savedRanges(userData).comments).toEqual(['[[0,4],[10,14]]'])
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press(`${modifier}+z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Shift+z`)
    await expect(wrapper.locator('[data-kept-range]')).toHaveText(['What', 'done'])
    expect(await page.evaluate(() => CSS.highlights.has('ai-pending-keep'))).toBe(false)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('overlapping Ctrl selections merge and Escape or an outside click cancels without saving', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const wrapper = await prepareComment(page, mock.url)
    await page.keyboard.down('Control')
    await mouseSelect(page, wrapper, 0, 4)
    await mouseSelect(page, wrapper, 0, 9)
    await expect(wrapper).toHaveAttribute('data-pending-count', '1')
    await page.keyboard.up('Control')
    await wrapper.focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-keep-pin]')).toHaveCount(0)
    expect(await page.evaluate(() => CSS.highlights.has('ai-pending-keep'))).toBe(false)
    expect(savedRanges(userData).comments).toEqual(['[]'])
    await page.keyboard.down('Control')
    await mouseSelect(page, wrapper, 10, 14)
    await page.keyboard.up('Control')
    await expect(wrapper).toHaveAttribute('data-pending-count', '1')
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('[data-keep-pin]')).toHaveCount(0)
    expect(await page.evaluate(() => CSS.highlights.has('ai-pending-keep'))).toBe(false)
    expect(savedRanges(userData).comments).toEqual(['[]'])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('Tab outside cancels drafts and Enter on kept text commits a pending phrase', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const wrapper = await prepareComment(page, mock.url)
    await mouseSelect(page, wrapper, 0, 4)
    await page.locator('[data-keep-pin]').click()
    await expect(wrapper.locator('[data-kept-range]')).toHaveText('What')
    await page.keyboard.down('Control')
    await mouseSelect(page, wrapper, 10, 14)
    await page.keyboard.up('Control')
    await page.locator('[data-keep-pin]').focus()
    await expect(page.locator('[data-keep-pin]')).toBeFocused()
    await page.keyboard.press('Tab')
    const axe = page.locator('.ai-comment-tools').getByRole('button', { name: 'Delete', exact: true })
    await expect(axe).toBeFocused()
    expect(await axe.evaluate((element) => element.closest('[data-keep-text]'))).toBeNull()
    await expect(page.locator('[data-keep-pin]')).toHaveCount(0)
    expect(await page.evaluate(() => window.getSelection()?.rangeCount)).toBe(0)
    await expect(wrapper).not.toHaveAttribute('data-pending-count')
    expect(await page.evaluate(() => CSS.highlights.has('ai-pending-keep'))).toBe(false)
    await expect.poll(() => savedRanges(userData).comments).toEqual(['[[0,4]]'])
    await page.keyboard.down('Control')
    await mouseSelect(page, wrapper, 10, 14)
    await page.keyboard.up('Control')
    await wrapper.locator('[data-kept-range]').focus()
    await page.keyboard.press('Enter')
    await expect(wrapper.locator('[data-kept-range]')).toHaveText(['What', 'done'])
    await expect(wrapper.locator('[data-remove-label]')).toHaveCount(0)
    await expect.poll(() => savedRanges(userData).comments).toEqual(['[[0,4],[10,14]]'])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('element-boundary selection keeps text and reveal preserves the text nodes', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const wrapper = await prepareComment(page, mock.url)
    await wrapper.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element.querySelector('.ai-keep-text')!)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    await page.locator('[data-keep-pin]').click()
    await expect.poll(() => savedRanges(userData).comments).toEqual(['[[0,34]]'])
    const textNode = await wrapper.locator('.ai-keep-text').elementHandle()
    await page.mouse.move(5, 5)
    await expect(wrapper).toHaveAttribute('data-keep-state', 'kept')
    await wrapper.locator('[data-kept-range]').first().hover()
    await expect(wrapper).toHaveAttribute('data-keep-state', 'full')
    expect(await wrapper.evaluate((element, previous) => element.querySelector('.ai-keep-text') === previous, textNode)).toBe(true)
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('Ctrl selection is staged when the mouse is released just outside the text', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const wrapper = await prepareComment(page, mock.url)
    await page.keyboard.down('Control')
    await mouseSelect(page, wrapper, 0, 34, true)
    await page.keyboard.up('Control')
    await expect(wrapper).toHaveAttribute('data-pending-count', '1')
    expect(savedRanges(userData).comments).toEqual(['[]'])
    await page.locator('[data-keep-pin]').click()
    await expect.poll(() => savedRanges(userData).comments).toEqual(['[[0,34]]'])
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

test('Ctrl-held phrase selection also works in an AI reply without changing the original comment', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    const comment = await prepareComment(page, mock.url)
    mock.setChatMode('reply')
    await page.getByRole('textbox', { name: 'Write back' }).fill('Give one smaller step.')
    await page.getByRole('button', { name: 'Send reply' }).click()
    const reply = page.locator('.ai-reply-ai [data-keep-text]')
    await expect(reply).toHaveText('A smaller first step still counts.')
    await page.keyboard.down('Control')
    await mouseSelect(page, reply, 2, 9)
    await mouseSelect(page, reply, 16, 20)
    await page.keyboard.up('Control')
    await expect(page.locator('[data-keep-pin]')).toHaveAttribute('data-keep-count', '2')
    await page.locator('[data-keep-pin]').click()
    await page.mouse.move(5, 5)
    await expect(reply.locator('[data-kept-range]')).toHaveText(['smaller', 'step'])
    await expect(comment.locator('[data-kept-range]')).toHaveCount(0)
    await expect.poll(() => savedRanges(userData)).toEqual({ comments: ['[]'], replies: ['[]', '[[2,9],[16,20]]'] })
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})

for (const mode of ['reply', 'null', 'error500'] as const) {
  test(`a pending ${mode} reply shows three dots and clears them when it finishes`, async () => {
    const mock = await startMockLmStudio()
    const { app, page, userData } = await launchApp()
    try {
      await prepareComment(page, mock.url)
      mock.setChatMode(mode)
      mock.holdChatResponses()
      await page.getByRole('textbox', { name: 'Write back' }).fill('Give one concrete detail.')
      await page.getByRole('button', { name: 'Send reply' }).click()
      await expect.poll(() => chatPosts(mock).length).toBe(2)
      const dots = page.getByRole('status', { name: 'AI is replying' })
      await expect(dots).toBeVisible()
      await expect(dots.locator('span')).toHaveCount(3)
      await expect(page.getByRole('textbox', { name: 'Write back' })).toBeDisabled()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(dots.locator('span').first()).toHaveCSS('animation-name', 'none')
      mock.releaseChatResponses()
      await expect(dots).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'Write back' })).toBeEnabled()
      if (mode === 'reply') {
        await expect(page.locator('[data-ai-replies]')).toContainText('A smaller first step still counts.')
      } else {
        await expect(page.locator('[data-ai-replies]')).toHaveCount(0)
      }
    } finally {
      await closeApp(app, userData)
      await mock.close()
    }
  })
}

test('long reply threads grow to show every message without an inner scrollbar', async () => {
  const mock = await startMockLmStudio()
  const { app, page, userData } = await launchApp()
  try {
    await prepareComment(page, mock.url)
    mock.setChatMode('reply')
    for (let index = 0; index < 2; index++) {
      await page.getByRole('textbox', { name: 'Write back' }).fill(`Detail ${index + 1}: ${'Explain the final deadline in detail. '.repeat(6)}`)
      await page.getByRole('button', { name: 'Send reply' }).click()
      await expect(page.locator('[data-ai-replies] .ai-reply')).toHaveCount((index + 1) * 2)
    }
    const thread = page.locator('[data-ai-replies]')
    await expect(thread).toHaveCSS('max-height', 'none')
    await expect(thread).toHaveCSS('overflow-y', 'visible')
    const size = await thread.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }))
    expect(size.height).toBeGreaterThan(180)
    expect(size.scroll).toBeLessThanOrEqual(size.height + 1)
    await expect(thread.locator('.ai-reply-user').last()).toContainText('Detail 2:')
  } finally {
    await closeApp(app, userData)
    await mock.close()
  }
})
