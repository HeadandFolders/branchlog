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
  width: number
  height: number
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
}

function savedImage(userData: string): ImageRow | null {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT width, height, cropLeft, cropTop, cropRight, cropBottom FROM images').get() as
    | ImageRow
    | undefined
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

async function renderedImage(page: Page): Promise<{ frameWidth: number; imgWidth: number; imgHeight: number; imgTop: number }> {
  return page.evaluate(() => {
    const frame = document.querySelector('.canvas-image-frame')
    const img = frame?.querySelector('img')
    if (!frame || !img) throw new Error('Image frame is missing')
    const frameBox = frame.getBoundingClientRect()
    const imgBox = img.getBoundingClientRect()
    return {
      frameWidth: Math.round(frameBox.width),
      imgWidth: Math.round(imgBox.width),
      imgHeight: Math.round(imgBox.height),
      imgTop: Math.round(imgBox.top - frameBox.top),
    }
  })
}

async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(handle).boundingBox()
  if (!box) throw new Error(`Handle ${handle} is missing`)
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 })
  await page.mouse.up()
}

test('crop trims two sides, undoes, redoes, and survives a restart', async () => {
  const launched = await launchApp()
  let { app, page, userData } = launched
  try {
    // The 200x120 bitmap is shrunk to fit MAX_EDGE only when larger; here it is kept as-is.
    await dropPhoto(app, page)
    const node = page.locator('.react-flow__node-image')
    await expect(node).toBeVisible()
    await settle(page)
    const box = await node.boundingBox()
    if (!box) throw new Error('Image node is missing')
    expect(Math.round(box.width)).toBe(200)

    await node.click()
    await expect(page.locator('.image-crop-right')).toBeVisible()
    expect(await renderedImage(page)).toEqual({ frameWidth: 200, imgWidth: 200, imgHeight: 120, imgTop: 0 })

    // Trim 50px from the right: width 200 -> 150, cropRight -> 0.25.
    await dragHandle(page, '.image-crop-right', -50, 0)
    await settle(page)
    await expect.poll(async () => Math.round((await node.boundingBox())!.width)).toBe(150)
    expect(savedImage(userData)).toEqual({
      width: 150,
      height: 120,
      cropLeft: 0,
      cropTop: 0,
      cropRight: 0.25,
      cropBottom: 0,
    })
    // The picture is cropped, not squeezed: the img stays 200px wide inside a 150px frame.
    expect(await renderedImage(page)).toEqual({ frameWidth: 150, imgWidth: 200, imgHeight: 120, imgTop: 0 })

    // Trim 30px from the top: height 120 -> 90, cropTop -> 0.25.
    await dragHandle(page, '.image-crop-top', 0, 30)
    await settle(page)
    expect(savedImage(userData)).toEqual({
      width: 150,
      height: 90,
      cropLeft: 0,
      cropTop: 0.25,
      cropRight: 0.25,
      cropBottom: 0,
    })
    // The img keeps its 200x120 rendered size and is shifted up 30px behind the 150x90 frame.
    expect(await renderedImage(page)).toEqual({ frameWidth: 150, imgWidth: 200, imgHeight: 120, imgTop: -30 })

    // Undo both trims, then redo them.
    await page.keyboard.press(`${modifier}+z`)
    await page.keyboard.press(`${modifier}+z`)
    await expect
      .poll(() => savedImage(userData))
      .toEqual({ width: 200, height: 120, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 })
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await page.keyboard.press(`${modifier}+Shift+Z`)
    await expect.poll(() => savedImage(userData)).toEqual({
      width: 150,
      height: 90,
      cropLeft: 0,
      cropTop: 0.25,
      cropRight: 0.25,
      cropBottom: 0,
    })

    // The crop is still there after a restart, and the picture renders trimmed.
    const next = await relaunch(userData)
    app = next.app
    page = next.page
    await expect(page.locator('.react-flow__node-image')).toBeVisible()
    await settle(page)
    const after = await page.locator('.react-flow__node-image').boundingBox()
    if (!after) throw new Error('Image node is missing after restart')
    expect(Math.round(after.width)).toBe(150)
    expect(Math.round(after.height)).toBe(90)
    expect(await renderedImage(page)).toEqual({ frameWidth: 150, imgWidth: 200, imgHeight: 120, imgTop: -30 })
    expect(savedImage(userData)).toEqual({
      width: 150,
      height: 90,
      cropLeft: 0,
      cropTop: 0.25,
      cropRight: 0.25,
      cropBottom: 0,
    })
  } finally {
    await closeApp(app, userData)
  }
})
