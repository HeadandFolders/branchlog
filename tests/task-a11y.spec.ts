import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier, writeTask } from './launch'

test.describe('editor access', () => {
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

  test('right-to-left text sets the paragraph direction', async () => {
    const task = await writeTask(page, 'שלום')
    await expect(task).toHaveAttribute('dir', 'rtl')
    await expect(task).toHaveCSS('direction', 'rtl')
  })

  test('a task is tabbable, multiline, and shows a focus ring', async () => {
    const task = await writeTask(page, 'hello')
    await expect(task).toHaveAttribute('aria-multiline', 'true')
    await page.keyboard.press('Escape')
    let outline = ''
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab')
      outline = await page.evaluate(() => {
        const element = document.activeElement
        if (!(element instanceof HTMLElement) || !element.matches('[data-task-text]')) return ''
        return getComputedStyle(element).outlineStyle
      })
      if (outline) break
    }
    expect(outline).not.toBe('')
    expect(outline).not.toBe('none')
  })

  test('spellcheck is on while editing', async () => {
    const task = await writeTask(page, 'hello')
    await expect(task).toHaveJSProperty('spellcheck', true)
    await page.keyboard.press('Escape')
    await expect(task).toHaveJSProperty('spellcheck', false)
  })

  test('the edit menu and spelling suggestions are available', async () => {
    const labels = await app.evaluate(({ Menu }) => {
      const edit = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Edit')
      return edit?.submenu?.items.map((item) => item.label ?? item.role) ?? []
    })
    expect(labels).toContain('Undo')
    expect(labels).toContain('Cut')
    expect(labels).toContain('Paste')
    expect(labels).toContain('Select All')
    const context = await app.evaluate(() => {
      const build = (globalThis as { __branchlogEditLabels?: (suggestions: string[]) => string[] }).__branchlogEditLabels
      return build?.(['hello', 'help']) ?? []
    })
    expect(context).toEqual(['hello', 'help', 'Cut', 'Copy', 'Paste', 'Select All'])
  })

  test('the edit menu cuts and selects the focused task', async () => {
    const task = await writeTask(page, 'hello')
    await page.keyboard.press(`${modifier}+A`)
    await app.evaluate(({ Menu }) => {
      const edit = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Edit')
      edit?.submenu?.items.find((item) => item.label === 'Cut')?.click()
    })
    await expect(task).toHaveText('')
    await page.keyboard.type('again')
    await app.evaluate(({ Menu }) => {
      const edit = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Edit')
      edit?.submenu?.items.find((item) => item.label === 'Select All')?.click()
    })
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(selected).toBe('again')
  })

  test('right-click makes the task editable for the context menu', async () => {
    await writeTask(page, 'hello')
    await page.keyboard.press('Escape')
    await page.locator('[data-task-text]').click({ button: 'right' })
    await expect(page.locator('[data-task-text]')).toHaveJSProperty('isContentEditable', true)
  })
})
