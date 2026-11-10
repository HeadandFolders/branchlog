import { expect, test, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier } from './launch'

const modLabel = modifier === 'Meta' ? '⌘' : 'Ctrl'

function panel(page: Page) {
  return page.getByRole('group', { name: 'Keyboard shortcuts' })
}

test('the shortcut note sits in the top-left and opens on hover', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const trigger = page.getByRole('button', { name: 'Keyboard shortcuts' })
    await expect(trigger).toBeVisible()
    const box = await trigger.boundingBox()
    expect(box?.x ?? 0).toBeLessThan(200)
    expect(box?.y ?? 0).toBeLessThan(40)

    await expect(panel(page)).toBeHidden()
    await trigger.hover()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toContainText('New task')
    await expect(panel(page)).toContainText('Branch from task')
    await expect(panel(page)).toContainText('AI margin (LM Studio)')
    await expect(panel(page)).toContainText('Theme Lab')
    await expect(panel(page)).toContainText('Alt+Enter')
    await expect(panel(page)).toContainText(`${modLabel}+Shift+T`)

    const family = await panel(page).evaluate((element) => getComputedStyle(element).fontFamily)
    expect(family).toContain('Caveat')

    await page.mouse.move(700, 520)
    await expect(panel(page)).toBeHidden()
  } finally {
    await closeApp(app, userData)
  }
})

test('a click pins the note and Escape lets it go', async () => {
  const { app, page, userData } = await launchApp()
  try {
    const trigger = page.getByRole('button', { name: 'Keyboard shortcuts' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(panel(page)).toBeVisible()

    await page.mouse.move(700, 520)
    await expect(panel(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.focus()
    await expect(panel(page)).toBeHidden()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  } finally {
    await closeApp(app, userData)
  }
})
