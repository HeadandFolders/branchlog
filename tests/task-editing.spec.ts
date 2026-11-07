import { spawnSync } from 'node:child_process'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function launchApp(): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = await mkdtemp(path.join(tmpdir(), 'branchlog-e2e-'))
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    cwd: root,
    args: [root],
    env: {
      ...process.env,
      BRANCHLOG_USER_DATA: userData,
      ELECTRON_RENDERER_URL: '',
    },
    timeout: 30_000,
  })
  const page = await app.firstWindow()
  await page.getByRole('textbox', { name: 'New task' }).waitFor()
  return { app, page, userData }
}

async function writeTask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'New task' })
  await input.click()
  await page.keyboard.type(text)
  const task = page.locator('[data-task-text]').first()
  await expect(task).toHaveText(text)
  return task
}

async function dragSelectAndType(page: Page, branch: ReturnType<Page['locator']>, insert: string) {
  const box = await branch.boundingBox()
  if (!box) throw new Error('Branch text has no box')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 4, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 4, y, { steps: 10 })
  await page.mouse.up()
  const before = await branch.evaluate((element) => {
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const selected =
      range && !range.collapsed && element.contains(range.startContainer) ? range.toString() : ''
    return { text: element.textContent ?? '', selected }
  })
  expect(before.selected.length).toBeGreaterThan(0)
  await page.keyboard.type(insert)
  const next = before.text.replace(before.selected, insert)
  await expect(branch).toHaveText(next)
  return next
}

async function caretOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-task-text]')
    const selection = window.getSelection()
    if (!element || !selection || selection.rangeCount === 0) return -1
    const range = selection.getRangeAt(0)
    if (!element.contains(range.endContainer)) return -1
    const before = range.cloneRange()
    before.selectNodeContents(element)
    before.setEnd(range.endContainer, range.endOffset)
    return before.toString().length
  })
}

test.describe('task text editing', () => {
  let app: ElectronApplication
  let page: Page
  let userData = ''

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    page = launched.page
    userData = launched.userData
  })

  test.afterEach(async () => {
    const pid = app.process().pid
    if (pid && process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      app.process().kill('SIGKILL')
    }
    await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  })

  test('select and type over', async () => {
    const task = await writeTask(page, 'hello world')
    for (let index = 0; index < 'world'.length; index += 1) {
      await page.keyboard.press('Shift+ArrowLeft')
    }
    await page.keyboard.type('there')
    await expect(task).toHaveText('hello there')

    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('hello world')
    await expect(task).toHaveText('hello world')
    const box = await task.boundingBox()
    if (!box) throw new Error('Task text has no box')
    await page.mouse.move(box.x + 8, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 15 })
    await page.mouse.up()
    const before = await page.evaluate(() => {
      const element = document.querySelector('[data-task-text]')
      const selection = window.getSelection()
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
      const selected =
        element && range && !range.collapsed && element.contains(range.startContainer) ? range.toString() : ''
      return {
        text: element?.textContent ?? '',
        selected,
        editable: element instanceof HTMLElement && element.isContentEditable,
        active: document.activeElement === element,
      }
    })
    expect(before.editable).toBe(true)
    expect(before.active).toBe(true)
    expect(before.selected.length).toBeGreaterThan(0)
    await page.keyboard.type('Q')
    await expect(task).toHaveText(before.text.replace(before.selected, 'Q'))
  })

  test('select all and type over', async () => {
    await writeTask(page, 'hello')
    await page.keyboard.press('Enter')
    await page.keyboard.type('world')
    const tasks = page.locator('[data-task-text]')
    await expect(tasks).toHaveCount(2)
    await tasks.nth(0).click()
    await page.keyboard.press(`${modifier}+A`)
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(selected).toBe('hello')
    await page.keyboard.type('X')
    await expect(tasks.nth(0)).toHaveText('X')
    await expect(tasks.nth(1)).toHaveText('world')
  })

  test('backspace in non-empty text edits the text', async () => {
    const task = await writeTask(page, 'hello')
    await page.keyboard.press('Backspace')
    await expect(task).toHaveText('hell')
    await expect(page.locator('[data-task-text]')).toHaveCount(1)
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press('Backspace')
    await expect(page.locator('[data-task-text]')).toHaveCount(1)
    await expect(task).toHaveText('')
  })

  test('backspace in empty text deletes the task', async () => {
    await writeTask(page, 'a')
    await page.keyboard.press('Backspace')
    await expect(page.locator('[data-task-text]')).toHaveText('')
    await page.keyboard.press('Delete')
    await expect(page.locator('[data-task-text]')).toHaveCount(1)
    await page.keyboard.press('Backspace')
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'New task' })).toBeVisible()
  })

  test('backspace on a selected node does not delete it', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branch = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branch).toBeVisible()
    await branch.click()
    await page.keyboard.type('keep me')
    await expect(branch).toHaveText('keep me')
    const point = await page.evaluate(() => {
      const node = document.querySelector('.react-flow__node-branch')
      if (!(node instanceof HTMLElement)) return null
      const rect = node.getBoundingClientRect()
      const samples = [
        { x: rect.left + 3, y: rect.top + 3 },
        { x: rect.left + 3, y: rect.bottom - 3 },
        { x: rect.right - 3, y: rect.top + 3 },
      ]
      for (const sample of samples) {
        const hit = document.elementFromPoint(sample.x, sample.y)
        if (!(hit instanceof Element)) continue
        if (hit.closest('[data-task-text], .branch-delete, .branch-dot, .task-check, button, a, input, textarea')) {
          continue
        }
        return sample
      }
      return { x: rect.left + 3, y: rect.top + 3 }
    })
    if (!point) throw new Error('Branch node is not on screen')
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('.react-flow__node-branch.selected')).toHaveCount(1)
    const editingText = await page.evaluate(
      () => document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-task-text]'),
    )
    expect(editingText).toBe(false)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')
    await expect(branch).toHaveText('keep me')
    await expect(page.locator('[data-task-text]').first()).toHaveText('origin')
  })

  test('paste over a selection inserts plain text', async () => {
    const task = await writeTask(page, 'hello world')
    for (let index = 0; index < 'world'.length; index += 1) {
      await page.keyboard.press('Shift+ArrowLeft')
    }
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(selected).toBe('world')
    const clipboardState = await app.evaluate(async ({ ClipboardItem, clipboard }) => {
      const previous = await clipboard.readText()
      await clipboard.write([
        new ClipboardItem({
          'text/plain': 'plain',
          'text/html': '<b>plain</b><img src="x" alt="nope">',
        }),
      ])
      return { previous, text: await clipboard.readText() }
    })
    expect(clipboardState.text).toBe('plain')
    await page.keyboard.press(`${modifier}+V`)
    await expect(task).toHaveText('hello plain')
    await expect(task).not.toContainText('<b>')
    const markup = await task.innerHTML()
    expect(markup).not.toContain('<b>')
    expect(markup).not.toContain('<img')
    await app.evaluate(async ({ clipboard }, previous) => {
      await clipboard.writeText(previous)
    }, clipboardState.previous)
  })

  test('select and type over in a branch', async () => {
    const input = page.getByRole('textbox', { name: 'New task' })
    await input.focus()
    await page.keyboard.type('origin')
    await expect(page.locator('[data-task-text]').first()).toHaveText('origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branch = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branch).toBeVisible()
    await branch.click()
    await page.keyboard.type('hello world')
    await expect(branch).toHaveText('hello world')
    for (let index = 0; index < 'world'.length; index += 1) {
      await page.keyboard.press('Shift+ArrowLeft')
    }
    await page.keyboard.type('there')
    await expect(branch).toHaveText('hello there')

    const replaced = await dragSelectAndType(page, branch, 'Q')
    expect(replaced).toContain('Q')

    await page.locator('.react-flow__node-mainList [data-task-text]').click()
    const again = await dragSelectAndType(page, branch, 'Z')
    expect(again).toContain('Z')

    const point = await page.evaluate(() => {
      const node = document.querySelector('.react-flow__node-branch')
      if (!(node instanceof HTMLElement)) return null
      const rect = node.getBoundingClientRect()
      const samples = [
        { x: rect.left + 3, y: rect.top + 3 },
        { x: rect.left + 3, y: rect.bottom - 3 },
        { x: rect.right - 3, y: rect.top + 3 },
      ]
      for (const sample of samples) {
        const hit = document.elementFromPoint(sample.x, sample.y)
        if (!(hit instanceof Element)) continue
        if (hit.closest('[data-task-text], .branch-delete, .branch-dot, .task-check, button, a, input, textarea')) continue
        return sample
      }
      return { x: rect.left + 3, y: rect.top + 3 }
    })
    if (!point) throw new Error('Branch node is not on screen')
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('.react-flow__node-branch.selected')).toHaveCount(1)
    const selectedNode = await dragSelectAndType(page, branch, 'Y')
    expect(selectedNode).toContain('Y')
  })

  test('typing in the middle of a word does not jump the caret', async () => {
    const task = await writeTask(page, 'abcde')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    expect(await caretOffset(page)).toBe(3)
    await page.keyboard.type('X')
    await expect(task).toHaveText('abcXde')
    expect(await caretOffset(page)).toBe(4)
    await page.waitForTimeout(400)
    expect(await caretOffset(page)).toBe(4)
    await page.keyboard.type('Y')
    await expect(task).toHaveText('abcXYde')
    expect(await caretOffset(page)).toBe(5)
  })
})
