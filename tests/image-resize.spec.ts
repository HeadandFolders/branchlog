import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, killProfile, launchApp, modifier, releaseUserData } from './launch'

declare global {
  interface Window {
    __branchlogLayout?: {
      finish: () => void
      idle: () => boolean
      generation: () => number
    }
  }
}

interface ImageRow {
  id: string
  x: number
  y: number
  width: number
  height: number
}

function savedImage(userData: string): ImageRow | null {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT id, x, y, width, height FROM images').get() as ImageRow | undefined
  db.close()
  return row ?? null
}

async function relaunch(userData: string): Promise<Awaited<ReturnType<typeof launchApp>>> {
  killProfile(userData)
  await new Promise((resolve) => setTimeout(resolve, 600))
  await releaseUserData(userData)
  try {
    return await launchApp(userData)
  } catch (error) {
    killProfile(userData)
    await new Promise((resolve) => setTimeout(resolve, 600))
    await releaseUserData(userData)
    try {
      return await launchApp(userData)
    } catch {
      throw error
    }
  }
}

async function settle(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => window.__branchlogLayout?.idle() ?? false)).toBe(true)
}

async function pasteImage(app: ElectronApplication, page: Page, at: { x: number; y: number }): Promise<void> {
  await app.evaluate(async ({ ClipboardItem, clipboard, nativeImage }) => {
    const buffer = Buffer.alloc(140 * 100 * 4)
    for (let index = 0; index < buffer.length; index += 4) {
      buffer[index] = 40
      buffer[index + 1] = 90
      buffer[index + 2] = 80
      buffer[index + 3] = 255
    }
    const png = nativeImage.createFromBitmap(buffer, { width: 140, height: 100 }).toPNG()
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png]) })])
  })
  await page.mouse.click(at.x, at.y)
  await page.keyboard.press(`${modifier}+V`)
  await expect(page.locator('.react-flow__node-image')).toBeVisible()
  await settle(page)
}

test('a pasted image resizes from a corner, keeps its ratio, saves, and undoes', async () => {
  const launched = await launchApp()
  const { page } = launched
  let { app, userData } = launched
  try {
    const paneBox = await page.locator('.react-flow__pane').boundingBox()
    if (!paneBox) throw new Error('Canvas pane is missing')
    await pasteImage(app, page, { x: paneBox.x + paneBox.width * 0.78, y: paneBox.y + paneBox.height * 0.6 })

    const image = page.locator('.react-flow__node-image')
    await expect(image.locator('.react-flow__resize-control')).toHaveCount(0)
    const before = await image.boundingBox()
    if (!before) throw new Error('Image box is missing')

    await image.click()
    const handle = image.locator('.react-flow__resize-control.handle.bottom.right')
    await expect(handle).toBeVisible()
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('Resize handle is missing')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + 70, handleBox.y + 20, { steps: 10 })
    await page.mouse.up()
    await settle(page)

    await expect
      .poll(async () => (await image.boundingBox())?.width ?? 0)
      .toBeGreaterThan(before.width + 40)
    const grown = await image.boundingBox()
    if (!grown) throw new Error('Image box is missing')
    const ratioBefore = before.width / before.height
    const ratioAfter = grown.width / grown.height
    expect(Math.abs(ratioAfter - ratioBefore)).toBeLessThan(0.15)

    await expect.poll(() => savedImage(userData)?.width ?? 0).toBeGreaterThan(before.width + 40)
    const stored = savedImage(userData)
    if (!stored) throw new Error('Saved image is missing')
    expect(Math.abs(stored.width - grown.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(stored.height - grown.height)).toBeLessThanOrEqual(2)

    await page.keyboard.press(`${modifier}+Z`)
    await settle(page)
    await expect
      .poll(async () => (await image.boundingBox())?.width ?? 0)
      .toBeLessThan(before.width + 10)
    await expect.poll(() => savedImage(userData)?.width ?? 0).toBeLessThan(before.width + 10)

    await page.keyboard.press(`${modifier}+Shift+Z`)
    await settle(page)
    await expect.poll(() => savedImage(userData)?.width ?? 0).toBeGreaterThan(before.width + 40)
    const redone = savedImage(userData)
    if (!redone) throw new Error('Saved image is missing')

    await closeApp(app, userData, true)
    const again = await relaunch(userData)
    app = again.app
    userData = again.userData
    const restored = again.page.locator('.react-flow__node-image')
    await expect(restored).toBeVisible()
    await settle(again.page)
    const restoredBox = await restored.boundingBox()
    if (!restoredBox) throw new Error('Restored image box is missing')
    expect(Math.abs(restoredBox.width - redone.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(restoredBox.height - redone.height)).toBeLessThanOrEqual(2)
  } finally {
    await closeApp(app, userData)
  }
})
