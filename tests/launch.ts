import { spawnSync } from 'node:child_process'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()

export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
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

export async function closeApp(app: ElectronApplication, userData: string): Promise<void> {
  const pid = app.process().pid
  if (pid && process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    app.process().kill('SIGKILL')
  }
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
}

export async function writeTask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'New task' })
  await input.click()
  await page.keyboard.type(text)
  const task = page.locator('[data-task-text]').first()
  await expect(task).toHaveText(text)
  return task
}
