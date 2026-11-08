import { spawnSync } from 'node:child_process'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()

export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

export interface LaunchOptions {
  env?: Record<string, string | undefined>
  timezoneId?: string
}

export async function launchApp(
  userData = '',
  options: LaunchOptions = {},
): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const dir = userData || (await mkdtemp(path.join(tmpdir(), 'branchlog-e2e-')))
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    cwd: root,
    args: [root, `--branchlog-profile=${dir}`],
    env: {
      ...process.env,
      BRANCHLOG_USER_DATA: dir,
      ELECTRON_RENDERER_URL: '',
      ...(options.timezoneId ? { TZ: options.timezoneId } : {}),
      ...options.env,
    },
    timeout: 30_000,
  })
  const page = await app.firstWindow()
  if (options.timezoneId) {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTimezoneOverride', { timezoneId: options.timezoneId })
    await page.reload()
  }
  await page.locator('[data-task-text], [aria-label="New task"]').first().waitFor()
  return { app, page, userData: dir }
}

export function killProfile(userData: string): void {
  if (process.platform !== 'win32') return
  const pidFile = path.join(userData, 'instance.pid')
  const listed = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Get-Content -LiteralPath ${JSON.stringify(pidFile)} -ErrorAction SilentlyContinue`],
    { encoding: 'utf8' },
  )
  const pid = Number.parseInt((listed.stdout ?? '').trim(), 10)
  if (Number.isFinite(pid) && pid > 0) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  const script = `$needle = ${JSON.stringify(userData)}; Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`
  spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
}

export async function releaseUserData(userData: string): Promise<void> {
  await rm(path.join(userData, 'lockfile'), { force: true }).catch(() => undefined)
  for (const name of ['GPUCache', 'Cache', 'Code Cache', 'DawnGraphiteCache', 'DawnWebGPUCache']) {
    await rm(path.join(userData, name), { recursive: true, force: true }).catch(() => undefined)
  }
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
    if (!gone && process.platform === 'win32') {
      if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      killProfile(userData)
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))])
      gone = child.exitCode !== null
    }
  } catch {
    gone = true
  }
  if (keepData) {
    killProfile(userData)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await releaseUserData(userData)
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
