import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, clipboard, nativeImage } from 'electron'
import type { CanvasImage, ImagePasteInput, ImageRecord } from '@shared/types'
import { getDatabase } from './database'

const MAX_EDGE = 480

interface ImageRow {
  id: string
  dateKey: string
  fileName: string
  x: number
  y: number
  width: number
  height: number
}

function imagesDir(): string {
  return path.join(app.getPath('userData'), 'images')
}

function filePath(fileName: string): string {
  if (!/^[0-9a-f-]{36}\.png$/i.test(fileName)) throw new Error('Invalid image')
  return path.join(imagesDir(), fileName)
}

function dataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`
}

function toImage(row: ImageRow): CanvasImage {
  const bytes = readFileSync(filePath(row.fileName))
  return { ...row, src: dataUrl(bytes) }
}

export function listImages(dateKey: string): CanvasImage[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, dateKey, fileName, x, y, width, height
       FROM images WHERE dateKey = ? ORDER BY rowid ASC`,
    )
    .all(dateKey) as ImageRow[]
  const images: CanvasImage[] = []
  for (const row of rows) {
    try {
      images.push(toImage(row))
    } catch (error) {
      console.error(error)
    }
  }
  return images
}

async function readClipboardPng(): Promise<Buffer | null> {
  const items = await clipboard.read()
  for (const item of items) {
    if (!item.types.includes('image/png')) continue
    const blob = await item.getType('image/png')
    if (!(blob instanceof Blob)) continue
    return Buffer.from(await blob.arrayBuffer())
  }
  return null
}

export async function pasteImage(input: ImagePasteInput): Promise<CanvasImage> {
  const bytes = await readClipboardPng()
  if (!bytes) throw new Error('Invalid image')
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error('Invalid image')
  const size = image.getSize()
  if (size.width < 1 || size.height < 1) throw new Error('Invalid image')
  const scale = Math.min(1, MAX_EDGE / Math.max(size.width, size.height))
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  const fileName = `${input.id}.png`
  mkdirSync(imagesDir(), { recursive: true })
  const png = image.toPNG()
  writeFileSync(filePath(fileName), png)
  getDatabase()
    .prepare(
      `INSERT INTO images (id, dateKey, fileName, x, y, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, input.dateKey, fileName, input.x, input.y, width, height)
  return {
    id: input.id,
    dateKey: input.dateKey,
    fileName,
    x: input.x,
    y: input.y,
    width,
    height,
    src: dataUrl(png),
  }
}

export function replaceImages(dateKey: string, images: ImageRecord[]): void {
  const db = getDatabase()
  const insert = db.prepare(
    `INSERT INTO images (id, dateKey, fileName, x, y, width, height)
     VALUES (@id, @dateKey, @fileName, @x, @y, @width, @height)`,
  )
  const run = db.transaction((rows: ImageRecord[]) => {
    db.prepare(`DELETE FROM images WHERE dateKey = ?`).run(dateKey)
    for (const row of rows) {
      if (row.dateKey !== dateKey) throw new Error('Invalid image')
      filePath(row.fileName)
      insert.run(row)
    }
  })
  run(images)
}
