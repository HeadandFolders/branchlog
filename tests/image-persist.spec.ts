import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { closeApp, killProfile, launchApp, releaseUserData } from './launch'

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

test('a dropped image is still on the day after closing and reopening', async () => {
  test.setTimeout(150_000)
  const launched = await launchApp()
  let { app, page, userData } = launched
  try {
    const paneBox = await page.locator('.react-flow__pane').boundingBox()
    if (!paneBox) throw new Error('Canvas pane is missing')
    const at = { x: paneBox.x + paneBox.width * 0.6, y: paneBox.y + paneBox.height * 0.5 }
    const base64 = await app.evaluate(({ nativeImage }) => {
      const buffer = Buffer.alloc(120 * 80 * 4)
      for (let index = 0; index < buffer.length; index += 4) {
        buffer[index] = 200
        buffer[index + 1] = 60
        buffer[index + 2] = 60
        buffer[index + 3] = 255
      }
      return nativeImage.createFromBitmap(buffer, { width: 120, height: 80 }).toPNG().toString('base64')
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
    await expect(page.locator('.react-flow__node-image')).toBeVisible()

    // Closing the window must actually end the process, or the next launch
    // loses the single-instance lock and never opens a window of its own.
    await app.close()

    const db = new Database(path.join(userData, 'branchlog.sqlite'))
    const rows = db.prepare('SELECT id, fileName FROM images').all() as { id: string; fileName: string }[]
    db.close()
    expect(rows).toHaveLength(1)

    const next = await relaunch(userData)
    app = next.app
    page = next.page
    await expect(page.locator('.react-flow__node-image')).toBeVisible()
  } finally {
    await closeApp(app, userData)
  }
})
