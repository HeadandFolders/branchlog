import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, launchApp } from './launch'

declare global {
  interface Window {
    __branchlogLayout?: {
      finish: () => void
      idle: () => boolean
      generation: () => number
    }
  }
}

async function settle(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => window.__branchlogLayout?.idle() ?? false)).toBe(true)
}

function savedImages(userData: string): { width: number; height: number }[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db.prepare('SELECT width, height FROM images').all() as { width: number; height: number }[]
  db.close()
  return rows
}

async function dropPoint(page: Page): Promise<{ x: number; y: number }> {
  const paneBox = await page.locator('.react-flow__pane').boundingBox()
  if (!paneBox) throw new Error('Canvas pane is missing')
  return { x: paneBox.x + paneBox.width * 0.78, y: paneBox.y + paneBox.height * 0.6 }
}

async function dropFile(
  page: Page,
  at: { x: number; y: number },
  file: { name: string; type: string; base64?: string; text?: string },
): Promise<void> {
  await page.evaluate(
    ({ at, file }) => {
      let bytes: Uint8Array
      if (file.base64) {
        const binary = atob(file.base64)
        bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      } else {
        bytes = new TextEncoder().encode(file.text ?? '')
      }
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], file.name, { type: file.type }))
      const target = document.elementFromPoint(at.x, at.y) ?? document.body
      const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: at.x, clientY: at.y }
      target.dispatchEvent(new DragEvent('dragover', init))
      target.dispatchEvent(new DragEvent('drop', init))
    },
    { at, file },
  )
}

test('dropping an image file puts it on the canvas and saves it', async () => {
  const launched = await launchApp()
  const { app, page, userData } = launched
  try {
    const base64 = await app.evaluate(({ nativeImage }) => {
      const buffer = Buffer.alloc(130 * 90 * 4)
      for (let index = 0; index < buffer.length; index += 4) {
        buffer[index] = 90
        buffer[index + 1] = 40
        buffer[index + 2] = 160
        buffer[index + 3] = 255
      }
      return nativeImage.createFromBitmap(buffer, { width: 130, height: 90 }).toPNG().toString('base64')
    })
    const at = await dropPoint(page)
    await dropFile(page, at, { name: 'photo.png', type: 'image/png', base64 })
    await expect(page.locator('.react-flow__node-image')).toBeVisible()
    await settle(page)
    await expect.poll(() => savedImages(userData).length).toBe(1)
    const stored = savedImages(userData)[0]
    expect(stored).toEqual({ width: 130, height: 90 })
  } finally {
    await closeApp(app, userData)
  }
})

test('dropping a file that is not an image shows an error', async () => {
  const launched = await launchApp()
  const { app, page, userData } = launched
  try {
    const at = await dropPoint(page)
    await dropFile(page, at, { name: 'notes.txt', type: 'text/plain', text: 'just text' })
    await expect(page.locator('[role="status"]', { hasText: 'Could not add that image.' })).toBeVisible()
    await expect(page.locator('.react-flow__node-image')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
  }
})
