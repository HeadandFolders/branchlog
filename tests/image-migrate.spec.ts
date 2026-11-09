import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { localDateKey } from '../src/shared/dates'
import { closeApp, launchApp } from './launch'

// A 1x1 PNG; listImages only reads the bytes and the renderer scales it to the row size.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface ImageRow {
  width: number
  height: number
  cropRight: number
}

function savedImage(userData: string): ImageRow | null {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const row = db.prepare('SELECT width, height, cropRight FROM images').get() as ImageRow | undefined
  db.close()
  return row ?? null
}

function imageColumns(userData: string): string[] {
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  db.pragma('busy_timeout = 3000')
  const rows = db.prepare('PRAGMA table_info(images)').all() as { name: string }[]
  db.close()
  return rows.map((row) => row.name)
}

test('an image saved before the crop columns still loads and crops', async () => {
  const userData = path.join(tmpdir(), `branchlog-migrate-${randomUUID()}`)
  mkdirSync(path.join(userData, 'images'), { recursive: true })
  const id = randomUUID()
  const db = new Database(path.join(userData, 'branchlog.sqlite'))
  // The images table as it existed before the crop feature: no cropLeft/cropTop/cropRight/cropBottom.
  db.exec(`
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      dateKey TEXT NOT NULL,
      fileName TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL,
      height REAL NOT NULL
    )
  `)
  db.prepare('INSERT INTO images (id, dateKey, fileName, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    localDateKey(),
    `${id}.png`,
    120,
    80,
    200,
    120,
  )
  db.close()
  writeFileSync(path.join(userData, 'images', `${id}.png`), TINY_PNG)

  const { app, page } = await launchApp(userData)
  try {
    await expect(page.locator('.react-flow__node-image')).toBeVisible()
    expect(imageColumns(userData)).toEqual(
      expect.arrayContaining(['cropLeft', 'cropTop', 'cropRight', 'cropBottom']),
    )
    expect(savedImage(userData)).toEqual({ width: 200, height: 120, cropRight: 0 })

    // Cropping an old row works: the UPDATE no longer fails on missing columns.
    const node = page.locator('.react-flow__node-image')
    await node.click()
    const handle = page.locator('.image-crop-right')
    await expect(handle).toBeVisible()
    const box = await handle.boundingBox()
    if (!box) throw new Error('Crop handle is missing')
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x - 25, from.y, { steps: 3 })
    await page.mouse.move(from.x - 50, from.y, { steps: 3 })
    await page.mouse.up()
    await expect
      .poll(() => savedImage(userData)?.width)
      .toBe(150)
    expect(savedImage(userData)).toEqual({ width: 150, height: 120, cropRight: 0.25 })
    await expect(page.locator('.canvas-image-frame img')).toBeVisible()
  } finally {
    await closeApp(app, userData)
  }
})
