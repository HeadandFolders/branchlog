import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, writeTask } from './launch'

function savedText(userData: string, id: string): string {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT text FROM tasks WHERE id = ?').get(id) as { text: string } | undefined
  db.close()
  return row?.text ?? ''
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

function parentOf(userData: string, id: string): string | null {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT parentId FROM tasks WHERE id = ?').get(id) as { parentId: string | null } | undefined
  db.close()
  return row?.parentId ?? null
}

test.describe('caret after the branch dot', () => {
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

  test('typing after the dot click goes into the new branch', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branch = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branch).toBeVisible()
    await page.keyboard.type('hello')
    await expect(branch).toHaveText('hello')
    await expect(page.locator('.react-flow__node-mainList [data-task-text]')).toHaveText('origin')
  })

  test('typing after a branch dot on a branch goes into the newest branch', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branches = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branches.nth(0)).toBeVisible()
    await page.keyboard.type('child')
    await expect(branches.nth(0)).toHaveText('child')
    await page.locator('.react-flow__node-branch').nth(0).getByRole('button', { name: 'Branch from this task' }).click()
    await expect(branches.nth(1)).toBeVisible()
    await page.keyboard.type('grand')
    await expect(branches.nth(1)).toHaveText('grand')
    await expect(branches.nth(0)).toHaveText('child')
  })

  test('typing after the dot on a middle task goes into that branch', async () => {
    await writeTask(page, 'one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Enter')
    await page.keyboard.type('three')
    const main = page.locator('.task-list [data-task-text]')
    await expect(main).toHaveText(['one', 'two', 'three'])
    const middleId = await main.nth(1).getAttribute('data-task-id')
    if (!middleId) throw new Error('Middle task id is missing')
    await page.locator('.task-list').getByRole('button', { name: 'Branch from this task' }).nth(1).click()
    const branch = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branch).toBeVisible()
    await page.keyboard.type('side')
    await expect(branch).toHaveText('side')
    await expect(main).toHaveText(['one', 'two', 'three'])
    const branchId = await branch.getAttribute('data-task-id')
    if (!branchId) throw new Error('Branch id is missing')
    expect(parentOf(userData, branchId)).toBe(middleId)
  })

  test('the new branch text field is focused after the dot click', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branch = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branch).toBeVisible()
    const branchId = await branch.getAttribute('data-task-id')
    const activeId = await page.evaluate(() =>
      document.activeElement instanceof HTMLElement ? (document.activeElement.dataset.taskId ?? '') : '',
    )
    expect(activeId).toBe(branchId)
    expect(activeId).not.toBe('')
  })

  test('enter still puts the caret in the new bullet', async () => {
    await writeTask(page, 'alpha')
    await page.keyboard.press('Enter')
    await page.keyboard.type('beta')
    await expect(page.locator('[data-task-text]')).toHaveText(['alpha', 'beta'])
  })

  test('text typed into a new branch is still there after restart', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branch = page.locator('.react-flow__node-branch [data-task-text]')
    await expect(branch).toBeVisible()
    await page.keyboard.type('saved')
    await expect(branch).toHaveText('saved')
    const branchId = await branch.getAttribute('data-task-id')
    if (!branchId) throw new Error('Branch id is missing')
    await expect.poll(() => savedText(userData, branchId)).toBe('saved')
    await closeApp(app, userData, true)
    const restarted = await relaunch(userData)
    app = restarted.app
    page = restarted.page
    await expect(page.locator('.react-flow__node-branch [data-task-text]')).toHaveText('saved')
    await expect(page.locator('.react-flow__node-mainList [data-task-text]')).toHaveText('origin')
  })
})
