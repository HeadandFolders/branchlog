import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, writeTask } from './launch'

test.describe('task keyboard navigation', () => {
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

  test('arrow up and down move between main-list bullets', async () => {
    await writeTask(page, 'alpha')
    await page.keyboard.press('Enter')
    await page.keyboard.type('beta')
    const tasks = page.locator('[data-task-text]')
    await expect(tasks).toHaveCount(2)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('Q')
    await expect(tasks.nth(0)).toContainText('Q')
    await expect(tasks.nth(1)).toHaveText('beta')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('Z')
    await expect(tasks.nth(1)).toHaveText('betaZ')
  })

  test('arrow up on a later line stays inside the task', async () => {
    await writeTask(page, 'one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('three')
    const tasks = page.locator('[data-task-text]')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('Q')
    await expect(tasks.nth(1)).toContainText('Q')
    await expect(tasks.nth(0)).toHaveText('one')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('Z')
    await expect(tasks.nth(0)).toContainText('Z')
    await expect(tasks.nth(1)).not.toContainText('Z')
  })

  test('escape leaves the text field', async () => {
    await writeTask(page, 'hello')
    await page.keyboard.press('Escape')
    const editing = await page.evaluate(
      () => document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-task-text]'),
    )
    expect(editing).toBe(false)
    await page.keyboard.type('Z')
    await expect(page.locator('[data-task-text]')).toHaveText('hello')
  })
})
