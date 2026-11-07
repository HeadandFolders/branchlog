import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

test.describe('undo and redo', () => {
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

  test('undo and redo typing after leaving the field, and the change is saved', async () => {
    const task = await writeTask(page, 'hello')
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(task).toHaveText('h')
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(task).toHaveText('hello')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(task).toHaveText('h')
    await page.getByRole('button', { name: 'Next day' }).click()
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.locator('[data-task-text]')).toHaveText('h')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('[data-task-text]')).toHaveText('h')
  })

  test('undo and redo a paste', async () => {
    const task = await writeTask(page, 'hello')
    await app.evaluate(async ({ clipboard }) => {
      await clipboard.writeText(' there')
    })
    await page.keyboard.press(`${modifier}+V`)
    await expect(task).toHaveText('hello there')
    await page.keyboard.press(`${modifier}+Z`)
    await expect(task).toHaveText('hello')
    await page.keyboard.press(`${modifier}+Y`)
    await expect(task).toHaveText('hello there')
  })

  test('undo rejoins a bullet split with enter', async () => {
    await writeTask(page, 'hello')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    const tasks = page.locator('[data-task-text]')
    await expect(tasks).toHaveCount(2)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(tasks).toHaveCount(1)
    await expect(tasks).toHaveText('hello')
  })

  test('undo restores a deleted task, a branch, and a checkbox', async () => {
    await writeTask(page, 'a')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expect(page.locator('[data-task-text]')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('[data-task-text]')).toHaveCount(1)

    await page.getByRole('button', { name: 'Branch from this task' }).click()
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(1)
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(0)

    await page.getByRole('checkbox', { name: 'Mark task done' }).click()
    await expect(page.getByRole('checkbox', { name: 'Mark task not done' })).toBeVisible()
    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.getByRole('checkbox', { name: 'Mark task done' })).toBeVisible()
    await page.keyboard.press(`${modifier}+Y`)
    await expect(page.getByRole('checkbox', { name: 'Mark task not done' })).toBeVisible()
  })

  test('undo puts a moved branch back', async () => {
    await writeTask(page, 'origin')
    await page.getByRole('button', { name: 'Branch from this task' }).click()
    const branch = page.locator('.react-flow__node-branch')
    await expect(branch).toBeVisible()
    const before = await branch.boundingBox()
    if (!before) throw new Error('Branch has no box')
    const point = await page.evaluate(() => {
      const node = document.querySelector('.react-flow__node-branch')
      if (!(node instanceof HTMLElement)) return null
      const rect = node.getBoundingClientRect()
      return { x: rect.left + 8, y: rect.top + rect.height - 8 }
    })
    if (!point) throw new Error('Branch node is not on screen')
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 120, point.y + 80, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await branch.boundingBox())?.x ?? 0).toBeGreaterThan(before.x + 40)
    await page.keyboard.press(`${modifier}+Z`)
    await expect.poll(async () => (await branch.boundingBox())?.x ?? 0).toBeLessThan(before.x + 20)
  })
})
