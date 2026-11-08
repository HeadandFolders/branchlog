import { spawnSync } from 'node:child_process'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()

export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

export async function launchApp(userData = ''): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const dir = userData || (await mkdtemp(path.join(tmpdir(), 'branchlog-e2e-')))
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    cwd: root,
    args: [root],
    env: {
      ...process.env,
      BRANCHLOG_USER_DATA: dir,
      ELECTRON_RENDERER_URL: '',
    },
    timeout: 30_000,
  })
  const page = await app.firstWindow()
  await page.locator('[data-task-text], [aria-label="New task"]').first().waitFor()
  return { app, page, userData: dir }
}

export async function closeApp(app: ElectronApplication, userData: string, keepData = false): Promise<boolean> {
  let gone = false
  try {
    const child = app.process()
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve()
      else child.once('exit', () => resolve())
    })
    const pid = child.pid
    if (pid && process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGKILL')
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))])
    gone = child.exitCode !== null
  } catch {
    gone = true
  }
  if (!keepData) await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  return gone
}

export async function writeTask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'New task' })
  await input.click()
  await page.keyboard.type(text)
  const task = page.locator('[data-task-text]').first()
  await expect(task).toHaveText(text)
  return task
}
