import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_LIGHT, THEME_TOKENS } from '../src/shared/theme'
import { closeApp, killProfile, launchApp, modifier, releaseUserData, writeTask } from './launch'

async function openLab(page: Page): Promise<void> {
  await page.bringToFront()
  await page.keyboard.press(`${modifier}+Shift+T`)
  await expect(page.getByRole('complementary', { name: 'Theme Lab' })).toBeVisible()
}

async function setToken(page: Page, token: string, hex: string): Promise<void> {
  await page.locator(`[aria-label="${token} color"]`).evaluate((element, value) => {
    const input = element as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, hex)
}

async function background(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase())
}

async function launchSaved(userData: string): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  let last = 'Restart did not open a window'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    killProfile(userData)
    await releaseUserData(userData)
    try {
      const started = await electron.launch({
        executablePath: path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
        cwd: process.cwd(),
        args: [process.cwd()],
        env: { ...process.env, BRANCHLOG_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
        timeout: 15_000,
      })
      const child = started.process()
      let logs = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        logs += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        logs += chunk.toString()
      })
      try {
        const page = await Promise.race([
          started.firstWindow({ timeout: 20_000 }),
          new Promise<Page>((_, reject) => {
            child.once('exit', (code) => reject(new Error(`App exited on restart (${code ?? 'none'})`)))
          }),
        ])
        await page.locator('[data-task-text], [aria-label="New task"]').first().waitFor()
        return { app: started, page, userData }
      } catch (error) {
        last = `${error instanceof Error ? error.message : 'Restart failed'}\n${logs}`
        if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      }
    } catch (error) {
      last = error instanceof Error ? error.message : 'Restart failed'
      killProfile(userData)
    }
  }
  throw new Error(last)
}

test('presets save, load, rename, and delete, and Default stays fixed', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openLab(page)
    await page.getByRole('radio', { name: 'Light' }).click()
    await setToken(page, 'bg', '#224466')
    await page.getByLabel('Preset name').fill('Moss')
    await page.getByRole('button', { name: 'Save theme' }).click()
    await setToken(page, 'bg', '#abcdef')
    await expect.poll(() => background(page)).toBe('#abcdef')
    await page.getByRole('button', { name: 'Load Moss' }).click()
    await expect.poll(() => background(page)).toBe('#224466')
    await page.getByLabel('Rename Moss').fill('Fern')
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Load Fern' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete Fern' }).click()
    await expect(page.getByRole('button', { name: 'Load Fern' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete Default' })).toHaveCount(0)
    await expect(page.getByLabel('Rename Default')).toHaveCount(0)
    await page.getByRole('button', { name: 'Load Default' }).click()
    await expect.poll(() => background(page)).toBe(DEFAULT_LIGHT.bg)
  } finally {
    await closeApp(app, userData)
  }
})

test('the active theme is already applied on the first frame after restart', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openLab(page)
    await page.getByRole('radio', { name: 'Light' }).click()
    await setToken(page, 'bg', '#123456')
    await page.keyboard.press('Escape')
    await expect.poll(() => background(page)).toBe('#123456')
  } finally {
    await closeApp(app, userData, true)
  }
  const next = await launchSaved(userData)
  try {
    await expect.poll(() => next.page.locator('html').getAttribute('data-first-bg')).toBe('rgb(18, 52, 86)')
    await expect.poll(() => background(next.page)).toBe('#123456')
    expect(await background(next.page)).not.toBe(DEFAULT_LIGHT.bg)
  } finally {
    await closeApp(next.app, next.userData)
  }
})

test('css and json round trip, and a bad import changes nothing', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openLab(page)
    await page.getByRole('radio', { name: 'Light' }).click()
    await setToken(page, 'ai', '#335577')
    await page.getByRole('button', { name: 'Copy as CSS' }).click()
    const css = await page.getByLabel('Theme export').inputValue()
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    for (const token of THEME_TOKENS) {
      expect(css.match(new RegExp(`--${token}:`, 'g'))?.length).toBe(2)
    }
    expect(css).toContain('#335577')
    await page.getByRole('button', { name: 'Copy as JSON' }).click()
    const json = await page.getByLabel('Theme export').inputValue()
    await setToken(page, 'ai', '#111111')
    await page.getByLabel('Import JSON').fill(json)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ai').trim()))
      .toBe('#335577')
    const before = await background(page)
    await page.getByLabel('Import JSON').fill('{')
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Invalid theme JSON')
    expect(await background(page)).toBe(before)
    await page.getByLabel('Import JSON').fill('{"light":{"bg":"red"},"dark":{"bg":"#000000"}}')
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Invalid color')
    expect(await background(page)).toBe(before)
  } finally {
    await closeApp(app, userData)
  }
})

test('theme undo and redo stay inside the panel', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const task = await writeTask(page, 'keep me')
    await openLab(page)
    const before = await background(page)
    await page.getByRole('button', { name: 'Randomize' }).click()
    await expect.poll(() => background(page)).not.toBe(before)
    await page.keyboard.press(`${modifier}+Z`)
    await expect.poll(() => background(page)).toBe(before)
    await expect(task).toHaveText('keep me')
    await setToken(page, 'bg', '#445566')
    await page.locator('[aria-label="bg color"]').blur()
    await page.keyboard.press(`${modifier}+Z`)
    await expect.poll(() => background(page)).toBe(before)
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect.poll(() => background(page)).toBe('#445566')
    await task.click()
    await page.keyboard.press(`${modifier}+Z`)
    await expect(task).not.toHaveText('keep me')
  } finally {
    await closeApp(app, userData)
  }
})
