import { expect, test } from '@playwright/test'
import { closeApp, launchApp, modifier } from './launch'

test('dragging a color leaves node render counts unchanged', async () => {
  test.setTimeout(120_000)
  const { app, page, userData } = await launchApp()
  try {
    await page.evaluate(() => {
      const date = document.querySelector<HTMLInputElement>('input[type="date"]')?.value
      if (!date) throw new Error('Missing date')
      const root = window.branchlog.tasks.createSync({
        id: crypto.randomUUID(),
        dateCreated: date,
        text: 'root',
        afterId: null,
      })
      if (!root.ok) throw new Error('Could not create the root task')
      for (let index = 0; index < 300; index += 1) {
        const wrote = window.branchlog.tasks.createBranchSync({
          id: crypto.randomUUID(),
          parentId: root.task.id,
          text: `branch ${index}`,
          x: 640 + (index % 25) * 24,
          y: 80 + Math.floor(index / 25) * 28,
        })
        if (!wrote.ok) throw new Error('Could not create a branch')
      }
    })
    await page.getByRole('button', { name: 'Next day' }).click()
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.locator('.react-flow__node-branch')).toHaveCount(300)
    await page.bringToFront()
    await page.keyboard.press(`${modifier}+Shift+T`)
    await expect(page.getByRole('complementary', { name: 'Theme Lab' })).toBeVisible()
    const before = await page.evaluate(() => (globalThis as { __blRenders?: Record<string, number> }).__blRenders?.BranchNode ?? 0)
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="bg color"]')
      if (!input) throw new Error('Missing color control')
      for (let step = 0; step < 30; step += 1) {
        input.value = step % 2 === 0 ? '#102030' : '#304050'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    const after = await page.evaluate(() => (globalThis as { __blRenders?: Record<string, number> }).__blRenders?.BranchNode ?? 0)
    expect(after).toBe(before)
    const started = Date.now()
    const field = page.locator('[data-task-text]', { hasText: 'root' })
    await field.click()
    await page.keyboard.type('quick')
    await expect(field).toHaveText('rootquick')
    expect(Date.now() - started).toBeLessThan(1500)
  } finally {
    await closeApp(app, userData)
  }
})
