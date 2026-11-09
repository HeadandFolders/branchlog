import { mkdtemp, rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, modifier } from './launch'

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

function savedImage(userData: string): { width: number; height: number } | null {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT width, height FROM images').get() as { width: number; height: number } | undefined
  db.close()
  return row ?? null
}

async function clickCanvas(page: Page): Promise<void> {
  const paneBox = await page.locator('.react-flow__pane').boundingBox()
  if (!paneBox) throw new Error('Canvas pane is missing')
  await page.mouse.click(paneBox.x + paneBox.width * 0.78, paneBox.y + paneBox.height * 0.6)
}

async function writeClipboardFileName(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(async ({ ClipboardItem, clipboard }, target) => {
    const bytes = Buffer.from(`${target}\0`, 'utf16le')
    await clipboard.write([
      new ClipboardItem({ 'electron application/osclipboard;format="FileNameW"': new Blob([bytes]) }),
    ])
  }, file)
}

test('an image copied from a web page pastes even with html and text on the clipboard', async () => {
  const launched = await launchApp()
  const { app, page, userData } = launched
  try {
    await app.evaluate(async ({ ClipboardItem, clipboard, nativeImage }) => {
      const buffer = Buffer.alloc(120 * 80 * 4)
      for (let index = 0; index < buffer.length; index += 4) {
        buffer[index] = 200
        buffer[index + 1] = 60
        buffer[index + 2] = 40
        buffer[index + 3] = 255
      }
      const png = nativeImage.createFromBitmap(buffer, { width: 120, height: 80 }).toPNG()
      await clipboard.write([
        new ClipboardItem({
          'text/plain': 'https://example.com/photo.jpg',
          'text/html': '<img src="https://example.com/photo.jpg">',
          'image/png': new Blob([png]),
        }),
      ])
    })
    await clickCanvas(page)
    await page.keyboard.press(`${modifier}+V`)
    await expect(page.locator('.react-flow__node-image')).toBeVisible()
    await settle(page)
    await expect.poll(() => savedImage(userData)?.width ?? 0).toBe(120)
  } finally {
    await closeApp(app, userData)
  }
})

test('a copied image file pastes from its path on the clipboard', async () => {
  const launched = await launchApp()
  const { app, page, userData } = launched
  const dir = await mkdtemp(path.join(tmpdir(), 'branchlog-paste-'))
  const jpg = path.join(dir, 'photo.jpg')
  try {
    const base64 = await app.evaluate(({ nativeImage }) => {
      const buffer = Buffer.alloc(100 * 60 * 4)
      for (let index = 0; index < buffer.length; index += 4) {
        buffer[index] = 30
        buffer[index + 1] = 120
        buffer[index + 2] = 70
        buffer[index + 3] = 255
      }
      return nativeImage.createFromBitmap(buffer, { width: 100, height: 60 }).toJPEG(90).toString('base64')
    })
    writeFileSync(jpg, Buffer.from(base64, 'base64'))
    await writeClipboardFileName(app, jpg)
    await clickCanvas(page)
    await page.keyboard.press(`${modifier}+V`)
    await expect(page.locator('.react-flow__node-image')).toBeVisible()
    await settle(page)
    await expect.poll(() => savedImage(userData)?.width ?? 0).toBe(100)
    expect(savedImage(userData)?.height).toBe(60)
  } finally {
    await closeApp(app, userData)
    await rm(dir, { recursive: true, force: true })
  }
})

test('a copied file that is not an image shows an error instead of nothing', async () => {
  const launched = await launchApp()
  const { app, page, userData } = launched
  const dir = await mkdtemp(path.join(tmpdir(), 'branchlog-paste-'))
  const notes = path.join(dir, 'notes.txt')
  try {
    writeFileSync(notes, 'just text')
    await writeClipboardFileName(app, notes)
    await clickCanvas(page)
    await page.keyboard.press(`${modifier}+V`)
    await expect(page.locator('[role="status"]', { hasText: 'Could not paste that image.' })).toBeVisible()
    await expect(page.locator('.react-flow__node-image')).toHaveCount(0)
  } finally {
    await closeApp(app, userData)
    await rm(dir, { recursive: true, force: true })
  }
})
