import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

test.describe('clipboard', () => {
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

  test('a multi-line paste stays in one bullet', async () => {
    const task = await writeTask(page, 'hello')
    await app.evaluate(async ({ clipboard }) => {
      await clipboard.writeText('one\ntwo')
    })
    await page.keyboard.press(`${modifier}+V`)
    await expect(page.locator('[data-task-text]')).toHaveCount(1)
    await expect(task).toHaveText('helloone\ntwo')
  })

  test('cut copies a selection that spans tasks and removes it', async () => {
    await writeTask(page, 'one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Escape')
    const first = page.locator('[data-task-text]').nth(0)
    const second = page.locator('[data-task-text]').nth(1)
    const start = await first.boundingBox()
    const end = await second.boundingBox()
    if (!start || !end) throw new Error('Task text has no box')
    await page.mouse.move(start.x + 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(end.x + end.width - 2, end.y + end.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+X`)
    await expect.poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('one\ntwo')
    await expect(first).toHaveText('')
    await expect(second).toHaveText('')
  })
})
