import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

const branchKey = 'Alt+Enter'
const branchTitle = process.platform === 'darwin' ? 'Branch (Option+Enter)' : 'Branch (Alt+Enter)'

function savedText(userData: string, id: string): string {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT text FROM tasks WHERE id = ?').get(id) as { text: string } | undefined
  db.close()
  return row?.text ?? ''
}

function parentOf(userData: string, id: string): string | null {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT parentId FROM tasks WHERE id = ?').get(id) as { parentId: string | null } | undefined
  db.close()
  return row?.parentId ?? null
}

async function openAgain(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const started = await electron.launch({
    executablePath: path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
    cwd: process.cwd(),
    args: [process.cwd()],
    env: { ...process.env, BRANCHLOG_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
    timeout: 15_000,
  })
  const child = started.process()
  try {
    const next = await Promise.race([
      started.firstWindow({ timeout: 10_000 }),
      new Promise<Page>((_, reject) => {
        child.once('exit', (code) => reject(new Error(`App exited on restart (${code})`)))
      }),
    ])
    return { app: started, page: next }
  } catch (error) {
    if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    throw error
  }
}

async function relaunch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  try {
    return await openAgain(userData)
  } catch {
    await rm(path.join(userData, 'lockfile'), { force: true }).catch(() => undefined)
    return openAgain(userData)
  }
}

async function activeTaskId(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.activeElement instanceof HTMLElement ? (document.activeElement.dataset.taskId ?? '') : '',
  )
}

async function branchTexts(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node-branch [data-task-text]').allTextContents()
}

async function nodeChrome(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((root) => {
    const node = document.querySelector(root)
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
  }, selector)
  if (!point) throw new Error('Branch node is not on screen')
  return point
}

test.describe('enter focuses the new branch', () => {
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
    await closeApp(app, userData)
  })

  test('typing after enter in a branch goes into the new node', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('next')
    await expect.poll(() => branchTexts(page)).toEqual(['first', 'next'])
    await expect(page.locator('.react-flow__node-mainList [data-task-text]')).toHaveText('origin')
  })

  test('enter in a branch of a branch focuses the new sibling', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('parent')
    await page.keyboard.press(branchKey)
    await page.keyboard.type('child')
    const child = page.locator('.react-flow__node-branch [data-task-text]').nth(1)
    const childId = await child.getAttribute('data-task-id')
    if (!childId) throw new Error('Child id is missing')
    await page.keyboard.press('Enter')
    await page.keyboard.type('next')
    await expect.poll(() => branchTexts(page)).toEqual(['parent', 'child', 'next'])
    const nextId = await page.locator('.react-flow__node-branch [data-task-text]').nth(2).getAttribute('data-task-id')
    if (!nextId) throw new Error('New branch id is missing')
    expect(parentOf(userData, nextId)).toBe(parentOf(userData, childId))
    expect(parentOf(userData, nextId)).not.toBe(childId)
  })

  test('enter in the middle of a branch splits and focuses the moved text', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('abcdef')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await page.keyboard.type('X')
    await expect.poll(() => branchTexts(page)).toEqual(['abc', 'Xdef'])
    const created = await page.locator('.react-flow__node-branch [data-task-text]').nth(1).getAttribute('data-task-id')
    if (!created) throw new Error('Split branch id is missing')
    await expect.poll(() => activeTaskId(page)).toBe(created)
    const offset = await page.evaluate((id) => {
      const element = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`)
      const selection = window.getSelection()
      if (!(element instanceof HTMLElement) || !selection || selection.rangeCount === 0) return -1
      const range = selection.getRangeAt(0)
      if (!element.contains(range.endContainer)) return -1
      const before = range.cloneRange()
      before.selectNodeContents(element)
      before.setEnd(range.endContainer, range.endOffset)
      return before.toString().length
    }, created)
    expect(offset).toBe(1)
  })

  test('three enters in a row put each word in its own node', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('keep')
    await page.keyboard.press('Enter')
    await page.keyboard.type('one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Enter')
    await page.keyboard.type('three')
    await expect.poll(() => branchTexts(page)).toEqual(['keep', 'one', 'two', 'three'])
  })

  test('enter in an empty branch and in a middle branch focuses the new node', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.press('Enter')
    await page.keyboard.type('tail')
    await expect.poll(() => branchTexts(page)).toEqual(['', 'tail'])
    await page.locator('.react-flow__node-branch [data-task-text]').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('mid')
    await page.keyboard.press('Enter')
    await page.keyboard.type('after')
    await expect.poll(() => branchTexts(page)).toEqual(['mid', 'tail', 'after'])
  })

  test('the new branch field is focused after enter before typing', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('first')
    const firstId = await page.locator('.react-flow__node-branch [data-task-text]').first().getAttribute('data-task-id')
    await page.keyboard.press('Enter')
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(2)
    const ids = await page.locator('.react-flow__node-branch [data-task-text]').evaluateAll((nodes) =>
      nodes.map((node) => (node instanceof HTMLElement ? (node.dataset.taskId ?? '') : '')),
    )
    const created = ids.find((id) => id && id !== firstId)
    if (!created) throw new Error('New branch id is missing')
    await expect.poll(() => activeTaskId(page)).toBe(created)
  })

  test('enter in the main list and the branch dot still focus the new field', async () => {
    await writeTask(page, 'alpha')
    await page.keyboard.press('Enter')
    await page.keyboard.type('beta')
    await expect(page.locator('.task-list [data-task-text]')).toHaveText(['alpha', 'beta'])
    const beta = page.locator('.task-list [data-task-text]').nth(1)
    await expect.poll(() => activeTaskId(page)).toBe(await beta.getAttribute('data-task-id'))
    await page.locator('.task-list').getByRole('button', { name: 'Branch from this task' }).nth(1).click()
    await page.keyboard.type('side')
    await expect(page.locator('.react-flow__node-branch [data-task-text]')).toHaveText('side')
    await expect(page.locator('.task-list [data-task-text]')).toHaveText(['alpha', 'beta'])
  })

  test('undo after enter removes the new node and focuses the previous one', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('first')
    const firstId = await page.locator('.react-flow__node-branch [data-task-text]').first().getAttribute('data-task-id')
    if (!firstId) throw new Error('Branch id is missing')
    await page.keyboard.press('Enter')
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(2)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(1)
    await expect(page.locator('.react-flow__node-branch [data-task-text]')).toHaveText('first')
    await expect.poll(() => activeTaskId(page)).toBe(firstId)
  })

  test('text typed into a branch created with enter is still there after restart', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('saved')
    await expect.poll(() => branchTexts(page)).toEqual(['first', 'saved'])
    const savedId = await page.locator('.react-flow__node-branch [data-task-text]').nth(1).getAttribute('data-task-id')
    if (!savedId) throw new Error('Saved branch id is missing')
    await expect.poll(() => savedText(userData, savedId)).toBe('saved')
    await closeApp(app, userData, true)
    const restarted = await relaunch(userData)
    app = restarted.app
    page = restarted.page
    await expect.poll(() => branchTexts(page)).toEqual(['first', 'saved'])
    await expect(page.locator('.react-flow__node-mainList [data-task-text]')).toHaveText('origin')
  })
})

test.describe('alt enter branches from the current task', () => {
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
    await closeApp(app, userData)
  })

  test('alt enter from a main-list task focuses the new branch', async () => {
    await writeTask(page, 'origin')
    await expect(page.locator('.branch-dot').first()).toHaveAttribute('title', branchTitle)
    await page.keyboard.press(branchKey)
    await page.keyboard.type('child')
    await expect(page.locator('.react-flow__node-branch [data-task-text]')).toHaveText('child')
    await expect(page.locator('.react-flow__node-mainList [data-task-text]')).toHaveText('origin')
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  })

  test('alt enter inside a branch focuses a branch of that branch', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('parent')
    const parentId = await page.locator('.react-flow__node-branch [data-task-text]').first().getAttribute('data-task-id')
    if (!parentId) throw new Error('Parent id is missing')
    await page.keyboard.press(branchKey)
    await page.keyboard.type('child')
    const child = page.locator('.react-flow__node-branch [data-task-text]').nth(1)
    await expect(child).toHaveText('child')
    const childId = await child.getAttribute('data-task-id')
    if (!childId) throw new Error('Child id is missing')
    expect(parentOf(userData, childId)).toBe(parentId)
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
    await expect(page.locator('.react-flow__node-branch [data-task-text]').first()).toHaveText('parent')
  })

  test('alt enter in the middle of the text does not split it', async () => {
    await writeTask(page, 'hello')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press(branchKey)
    await page.keyboard.type('child')
    await expect(page.locator('.react-flow__node-mainList [data-task-text]')).toHaveText('hello')
    await expect(page.locator('.react-flow__node-branch [data-task-text]')).toHaveText('child')
  })

  test('two alt enters nest two branches', async () => {
    await writeTask(page, 'root')
    const rootId = await page.locator('.task-list [data-task-text]').getAttribute('data-task-id')
    if (!rootId) throw new Error('Root id is missing')
    await page.keyboard.press(branchKey)
    await page.keyboard.type('outer')
    const outerId = await page.locator('.react-flow__node-branch [data-task-text]').nth(0).getAttribute('data-task-id')
    if (!outerId) throw new Error('Outer id is missing')
    await page.keyboard.press(branchKey)
    await page.keyboard.type('inner')
    const innerId = await page.locator('.react-flow__node-branch [data-task-text]').nth(1).getAttribute('data-task-id')
    if (!innerId) throw new Error('Inner id is missing')
    expect(parentOf(userData, outerId)).toBe(rootId)
    expect(parentOf(userData, innerId)).toBe(outerId)
    await expect.poll(() => branchTexts(page)).toEqual(['outer', 'inner'])
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
  })

  test('undo after alt enter removes the branch and focuses the previous task', async () => {
    await writeTask(page, 'origin')
    const originId = await page.locator('.task-list [data-task-text]').getAttribute('data-task-id')
    if (!originId) throw new Error('Task id is missing')
    await page.keyboard.press(branchKey)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(1)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
    await expect(page.locator('.task-list [data-task-text]')).toHaveText('origin')
    await expect.poll(() => activeTaskId(page)).toBe(originId)
  })

  test('alt enter creates one branch when the menu item exists', async () => {
    const menu = await app.evaluate(({ Menu }) => {
      const task = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Task')
      const branch = task?.submenu?.items.find((item) => item.label === 'Branch from task')
      return { accelerator: branch?.accelerator ?? '', registered: branch?.registerAccelerator ?? null }
    })
    expect(menu.accelerator).toBe('Alt+Enter')
    expect(menu.registered).toBe(false)
    await writeTask(page, 'origin')
    await page.keyboard.press(branchKey)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(1)
  })

  test('alt enter from a selected branch that is not being edited', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await page.keyboard.type('parent')
    const point = await nodeChrome(page, '.react-flow__node-branch')
    await page.mouse.click(point.x, point.y)
    await expect(page.locator('.react-flow__node-branch.selected')).toHaveCount(1)
    const editing = await page.evaluate(
      () => document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-task-text]'),
    )
    expect(editing).toBe(false)
    await page.keyboard.press(branchKey)
    await page.keyboard.type('child')
    await expect.poll(() => branchTexts(page)).toEqual(['parent', 'child'])
  })

  test('plain enter still splits and shift enter still breaks the line', async () => {
    await writeTask(page, 'ab')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('cd')
    await expect(page.locator('[data-task-text]')).toHaveCount(1)
    await expect(page.locator('[data-task-text]')).toHaveText('ab\ncd')
    await page.keyboard.press('Enter')
    await page.keyboard.type('next')
    await expect(page.locator('.task-list [data-task-text]')).toHaveText(['ab\ncd', 'next'])
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
  })

  test('alt enter in the date field and on an empty day does not create a branch', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('textbox', { name: 'Choose a date' }).focus()
    await page.keyboard.press(branchKey)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
    await expect(page.locator('.task-list [data-task-text]')).toHaveText('origin')
    await page.getByRole('button', { name: 'Next day' }).click()
    await page.getByRole('textbox', { name: 'New task' }).press(branchKey)
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
  })
})

test.describe('every creation path focuses the new field', () => {
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
    await closeApp(app, userData)
  })

  test('each way of creating a task focuses that field', async () => {
    const placeholder = page.getByRole('textbox', { name: 'New task' })
    await placeholder.click()
    await page.keyboard.type('A')
    const first = page.locator('[data-task-text]').first()
    await expect(first).toHaveText('A')
    await expect.poll(() => activeTaskId(page)).toBe(await first.getAttribute('data-task-id'))

    await page.keyboard.press('Enter')
    await page.keyboard.type('B')
    const second = page.locator('.task-list [data-task-text]').nth(1)
    await expect(second).toHaveText('B')
    await expect.poll(() => activeTaskId(page)).toBe(await second.getAttribute('data-task-id'))

    await page.locator('.task-list').getByRole('button', { name: 'Branch from this task' }).nth(1).click()
    const dotted = page.locator('.react-flow__node-branch [data-task-text]').first()
    await expect.poll(() => activeTaskId(page)).toBe(await dotted.getAttribute('data-task-id'))

    await page.keyboard.press('Enter')
    await page.keyboard.type('C')
    const entered = page.locator('.react-flow__node-branch [data-task-text]').nth(1)
    await expect(entered).toHaveText('C')
    await expect.poll(() => activeTaskId(page)).toBe(await entered.getAttribute('data-task-id'))

    await page.keyboard.press(branchKey)
    await page.keyboard.type('D')
    const branched = page.locator('.react-flow__node-branch [data-task-text]').nth(2)
    await expect(branched).toHaveText('D')
    await expect.poll(() => activeTaskId(page)).toBe(await branched.getAttribute('data-task-id'))

    const beforeMenu = await page.locator('.react-flow__node-branch').count()
    await app.evaluate(({ Menu }) => {
      const task = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Task')
      task?.submenu?.items.find((item) => item.label === 'Branch from task')?.click()
    })
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(beforeMenu + 1)
    const menuBranch = page.locator('.react-flow__node-branch [data-task-text]').nth(beforeMenu)
    await expect.poll(() => activeTaskId(page)).toBe(await menuBranch.getAttribute('data-task-id'))

    const returnTo = await activeTaskId(page)
    const mainCount = await page.locator('.task-list [data-task-text]').count()
    const branchCount = await page.locator('.react-flow__node-branch').count()
    await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()?.items.find((item) => item.label === 'File')
      file?.submenu?.items.find((item) => item.label === 'New task')?.click()
    })
    await expect(page.locator('.task-list [data-task-text]')).toHaveCount(mainCount + 1)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(branchCount)
    const added = page.locator('.task-list [data-task-text]').last()
    await expect(added).toHaveText('')
    const createdId = await added.getAttribute('data-task-id')
    await expect.poll(() => activeTaskId(page)).toBe(createdId)
    await page.keyboard.type('E')
    await expect(added).toHaveText('E')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(added).toHaveText('')
    await page.keyboard.press(`${modifier}+Z`)
    await expect.poll(() => activeTaskId(page)).toBe(returnTo)
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect.poll(() => activeTaskId(page)).toBe(createdId)

    await page.getByRole('button', { name: 'Next day' }).click()
    await page.getByRole('textbox', { name: 'New task' }).press('Enter')
    const blank = page.locator('[data-task-text]').first()
    await expect(blank).toHaveText('')
    await expect.poll(() => activeTaskId(page)).toBe(await blank.getAttribute('data-task-id'))
  })
})

test.describe('ctrl n adds a main-list task', () => {
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
    await closeApp(app, userData)
  })

  test('ctrl n from a branch adds one main-list task and leaves the branch unchanged', async () => {
    const menu = await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()?.items.find((item) => item.label === 'File')
      const item = file?.submenu?.items.find((entry) => entry.label === 'New task')
      return { accelerator: item?.accelerator ?? '', registered: item?.registerAccelerator ?? null }
    })
    expect(menu.accelerator).toBe('CmdOrCtrl+N')
    expect(menu.registered).toBe(false)

    await writeTask(page, 'origin')
    await page.keyboard.press(branchKey)
    await page.keyboard.type('child')
    const branch = page.locator('.react-flow__node-branch [data-task-text]')
    const branchId = await branch.getAttribute('data-task-id')
    if (!branchId) throw new Error('Branch id is missing')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press(`${modifier}+N`)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(1)
    await expect(branch).toHaveText('child')
    const added = page.locator('.task-list [data-task-text]').last()
    await expect(page.locator('.task-list [data-task-text]')).toHaveText(['origin', ''])
    const createdId = await added.getAttribute('data-task-id')
    await expect.poll(() => activeTaskId(page)).toBe(createdId)
    await page.keyboard.type('added')
    await expect(page.locator('.task-list [data-task-text]')).toHaveText(['origin', 'added'])
    await expect(branch).toHaveText('child')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(added).toHaveText('')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('.task-list [data-task-text]')).toHaveText('origin')
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(1)
    await expect.poll(() => activeTaskId(page)).toBe(branchId)
  })

  test('ctrl n in the middle of a main task inserts the next bullet without splitting', async () => {
    await writeTask(page, 'alpha')
    await page.keyboard.press('Enter')
    await page.keyboard.type('omega')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press(`${modifier}+N`)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)
    const added = page.locator('.task-list [data-task-text]').nth(1)
    await expect(page.locator('.task-list [data-task-text]')).toHaveText(['alpha', '', 'omega'])
    await expect.poll(() => activeTaskId(page)).toBe(await added.getAttribute('data-task-id'))
    await page.keyboard.type('mid')
    await expect(page.locator('.task-list [data-task-text]')).toHaveText(['alpha', 'mid', 'omega'])
  })
})
