import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_DARK, DEFAULT_LIGHT, THEME_TOKENS } from '../src/shared/theme'
import { closeApp, launchApp, modifier, writeTask } from './launch'

async function tokens(page: Page): Promise<Record<string, string>> {
  return page.evaluate((names) => {
    const style = getComputedStyle(document.documentElement)
    const read: Record<string, string> = {}
    for (const name of names) read[name] = style.getPropertyValue(`--${name}`).trim().toLowerCase()
    return read
  }, [...THEME_TOKENS])
}

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

test('opening and closing Theme Lab leaves the default tokens', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await page.emulateMedia({ colorScheme: 'light' })
    const lightBefore = await tokens(page)
    for (const token of THEME_TOKENS) expect(lightBefore[token]).toBe(DEFAULT_LIGHT[token])
    await openLab(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('complementary', { name: 'Theme Lab' })).toHaveCount(0)
    const lightAfter = await tokens(page)
    expect(lightAfter).toEqual(lightBefore)
    await page.emulateMedia({ colorScheme: 'dark' })
    const dark = await tokens(page)
    for (const token of THEME_TOKENS) expect(dark[token]).toBe(DEFAULT_DARK[token])
  } finally {
    await closeApp(app, userData)
  }
})

test('a color edit updates the page and the canvas stays editable', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openLab(page)
    await setToken(page, 'bg', '#123456')
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(18, 52, 86)')
    const task = await writeTask(page, 'still typing')
    await expect(task).toHaveText('still typing')
  } finally {
    await closeApp(app, userData)
  }
})

test('an edited token is marked and reset restores the default', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openLab(page)
    await page.getByRole('radio', { name: 'Light' }).click()
    const row = page.locator('[data-token="text"]')
    await expect(row).toHaveAttribute('data-changed', 'false')
    await setToken(page, 'text', '#112233')
    await expect(row).toHaveAttribute('data-changed', 'true')
    await expect(row).toContainText('Changed')
    await row.getByRole('button', { name: 'Reset --text' }).click()
    await expect(row).toHaveAttribute('data-changed', 'false')
    await expect.poll(() => tokens(page).then((value) => value.text)).toBe(DEFAULT_LIGHT.text)
  } finally {
    await closeApp(app, userData)
  }
})

test('the edge token paints branches and arrowheads', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await writeTask(page, 'parent')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await expect(page.locator('.react-flow__edge-path')).toHaveCount(1)
    await openLab(page)
    await setToken(page, 'edge', '#ff00aa')
    await expect
      .poll(() => page.locator('.react-flow__edge-path').first().evaluate((element) => getComputedStyle(element).stroke))
      .toBe('rgb(255, 0, 170)')
    await expect
      .poll(() =>
        page.locator('svg marker path, svg marker polyline').first().evaluate((element) => getComputedStyle(element).fill),
      )
      .toBe('rgb(255, 0, 170)')
    expect(await page.locator('.react-flow__minimap').count()).toBe(0)
    expect(await page.locator('.react-flow__background-pattern').count()).toBe(0)
  } finally {
    await closeApp(app, userData)
  }
})

test('light and dark preview override the system, and follow system restores it', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => tokens(page).then((value) => value.bg)).toBe(DEFAULT_DARK.bg)
    await openLab(page)
    await page.getByRole('radio', { name: 'Light' }).click()
    await expect.poll(() => tokens(page).then((value) => value.bg)).toBe(DEFAULT_LIGHT.bg)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('checkbox', { name: 'Follow system' }).check()
    await expect(page.locator('html')).not.toHaveAttribute('data-theme')
    await expect.poll(() => tokens(page).then((value) => value.bg)).toBe(DEFAULT_DARK.bg)
  } finally {
    await closeApp(app, userData)
  }
})

test('contrast ratios and the AA limit', async () => {
  const { app, page, userData } = await launchApp()
  try {
    await openLab(page)
    await page.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('[data-contrast="text-bg"]')).toHaveText('15.65')
    await expect(page.locator('[data-contrast-pass="text-bg"]')).toHaveText('Pass')
    await setToken(page, 'bg', '#ffffff')
    await setToken(page, 'text', '#000000')
    await expect(page.locator('[data-contrast="text-bg"]')).toHaveText('21.00')
    await expect(page.locator('[data-contrast-pass="text-bg"]')).toHaveText('Pass')
    await setToken(page, 'text', '#777777')
    await expect(page.locator('[data-contrast="text-bg"]')).toHaveText('4.48')
    await expect(page.locator('[data-contrast-pass="text-bg"]')).toHaveText('Fail')
    await setToken(page, 'text', '#767676')
    await expect(page.locator('[data-contrast="text-bg"]')).toHaveText('4.54')
    await expect(page.locator('[data-contrast-pass="text-bg"]')).toHaveText('Pass')
  } finally {
    await closeApp(app, userData)
  }
})
