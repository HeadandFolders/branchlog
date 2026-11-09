import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, clipboard, nativeImage } from 'electron'
import type { CanvasImage, ImageDropInput, ImagePasteInput, ImageRecord, ImageSizeInput } from '@shared/types'
import { getDatabase } from './database'

const MAX_EDGE = 480
const CLIPBOARD_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const

interface ImageRow {
  id: string
  dateKey: string
  fileName: string
  x: number
  y: number
  width: number
  height: number
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
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
      `SELECT id, dateKey, fileName, x, y, width, height, cropLeft, cropTop, cropRight, cropBottom
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

function pathFromUrl(url: string): string | null {
  try {
    return fileURLToPath(url.trim())
  } catch {
    return null
  }
}

async function clipboardFilePath(): Promise<string | null> {
  // A file copied in Explorer or Finder reaches the clipboard as file: URLs in text/uri-list.
  const items = await clipboard.read()
  for (const item of items) {
    if (!item.types.includes('text/uri-list')) continue
    const blob = await item.getType('text/uri-list')
    if (!(blob instanceof Blob)) continue
    const list = Buffer.from(await blob.arrayBuffer()).toString('utf8')
    for (const line of list.split(/\r?\n/)) {
      if (!line.startsWith('file:')) continue
      const parsed = pathFromUrl(line)
      if (parsed) return parsed
    }
  }
  return null
}

async function readClipboardImage(): Promise<Electron.NativeImage | null> {
  const items = await clipboard.read()
  for (const item of items) {
    for (const type of CLIPBOARD_IMAGE_TYPES) {
      if (!item.types.includes(type)) continue
      const blob = await item.getType(type)
      if (!(blob instanceof Blob)) continue
      const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
      if (!image.isEmpty()) return image
    }
  }
  const copied = await clipboardFilePath()
  if (!copied) return null
  const image = nativeImage.createFromPath(copied)
  return image.isEmpty() ? null : image
}

function saveImage(image: Electron.NativeImage, input: ImagePasteInput): CanvasImage {
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
    cropLeft: 0,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    src: dataUrl(png),
  }
}

export async function pasteImage(input: ImagePasteInput): Promise<CanvasImage> {
  const image = await readClipboardImage()
  if (!image) throw new Error('Invalid image')
  return saveImage(image, input)
}

export function dropImage(input: ImageDropInput): CanvasImage {
  const image = nativeImage.createFromBuffer(Buffer.from(input.bytes))
  if (image.isEmpty()) throw new Error('Invalid image')
  return saveImage(image, input)
}

export function resizeImage(input: ImageSizeInput): void {
  const result = getDatabase()
    .prepare(
      `UPDATE images
       SET x = ?, y = ?, width = ?, height = ?, cropLeft = ?, cropTop = ?, cropRight = ?, cropBottom = ?
       WHERE id = ?`,
    )
    .run(
      input.x,
      input.y,
      input.width,
      input.height,
      input.cropLeft,
      input.cropTop,
      input.cropRight,
      input.cropBottom,
      input.id,
    )
  if (result.changes !== 1) throw new Error('Invalid image')
}

export function deleteImages(ids: string[]): void {
  const db = getDatabase()
  const run = db.transaction((list: string[]) => {
    const statement = db.prepare('DELETE FROM images WHERE id = ?')
    let changes = 0
    for (const id of list) changes += statement.run(id).changes
    if (changes !== list.length) throw new Error('Invalid image')
  })
  run(ids)
}

export function replaceImages(dateKey: string, images: ImageRecord[]): void {
  const db = getDatabase()
  const insert = db.prepare(
    `INSERT INTO images (id, dateKey, fileName, x, y, width, height, cropLeft, cropTop, cropRight, cropBottom)
     VALUES (@id, @dateKey, @fileName, @x, @y, @width, @height, @cropLeft, @cropTop, @cropRight, @cropBottom)`,
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
