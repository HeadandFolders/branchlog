import { readdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier } from './launch'

function imageCount(userData: string): number {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT COUNT(*) AS count FROM images').get() as { count: number }
  db.close()
  return row.count
}

function imageFiles(userData: string): string[] {
  try {
    return readdirSync(path.join(userData, 'images'))
  } catch {
    return []
  }
}

async function dropPhoto(app: ElectronApplication, page: Page): Promise<void> {
  const paneBox = await page.locator('.react-flow__pane').boundingBox()
  if (!paneBox) throw new Error('Canvas pane is missing')
  const at = { x: paneBox.x + paneBox.width * 0.6, y: paneBox.y + paneBox.height * 0.5 }
  const base64 = await app.evaluate(({ nativeImage }) => {
    const buffer = Buffer.alloc(200 * 120 * 4)
    for (let index = 0; index < buffer.length; index += 4) {
      buffer[index] = 40
      buffer[index + 1] = 120
      buffer[index + 2] = 90
      buffer[index + 3] = 255
    }
    return nativeImage.createFromBitmap(buffer, { width: 200, height: 120 }).toPNG().toString('base64')
  })
  await page.evaluate(
    ({ at, base64 }) => {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'photo.png', { type: 'image/png' }))
      const target = document.elementFromPoint(at.x, at.y) ?? document.body
      const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: at.x, clientY: at.y }
      target.dispatchEvent(new DragEvent('dragover', init))
      target.dispatchEvent(new DragEvent('drop', init))
    },
    { at, base64 },
  )
}

test('a selected image deletes by Backspace or the axe button, and undo brings it back', async () => {
  const launched = await launchApp()
  let { app, page, userData } = launched
  try {
    await dropPhoto(app, page)
    const node = page.locator('.react-flow__node-image')
    await expect(node).toBeVisible()

    // Backspace on the selected image deletes the row but keeps the PNG for undo.
    await node.click()
    await page.keyboard.press('Backspace')
    await expect(node).toHaveCount(0)
    expect(imageCount(userData)).toBe(0)
    expect(imageFiles(userData)).toHaveLength(1)

    // Undo restores it, redo deletes it again, undo restores it once more.
    await page.keyboard.press(`${modifier}+z`)
    await expect(node).toBeVisible()
    expect(imageCount(userData)).toBe(1)
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect(node).toHaveCount(0)
    expect(imageCount(userData)).toBe(0)
    await page.keyboard.press(`${modifier}+z`)
    await expect(node).toBeVisible()
    expect(imageCount(userData)).toBe(1)

    // Backspace inside a task field edits the text and leaves the selected image alone.
    await node.click()
    const input = page.getByRole('textbox', { name: 'New task' })
    await input.focus()
    await page.keyboard.type('ab')
    await page.keyboard.press('Backspace')
    await expect(page.locator('[data-task-text]').first()).toHaveText('a')
    await expect(node).toBeVisible()
    expect(imageCount(userData)).toBe(1)

    // The axe button on a selected image deletes it too.
    await node.click()
    await page.getByRole('button', { name: 'Delete image' }).click()
    await expect(node).toHaveCount(0)
    expect(imageCount(userData)).toBe(0)

    // The deletion survives a restart.
    await closeApp(app, userData, true)
    const next = await launchApp(userData)
    app = next.app
    page = next.page
    await expect(page.locator('[data-task-text], [aria-label="New task"]').first()).toBeVisible()
    await expect(page.locator('.react-flow__node-image')).toHaveCount(0)
    expect(imageCount(userData)).toBe(0)
  } finally {
    await closeApp(app, userData)
  }
})
