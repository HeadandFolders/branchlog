import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  BRIEF_EXTENSIONS,
  BRIEF_MAX_CHARS,
  BRIEF_SUMMARY_MAX_CHARS,
  briefNameError,
  briefNameTaken,
  type Brief,
  type BriefView,
} from '@shared/ai-briefs'
import { getBrief, insertBrief, listBriefs, writeBriefRead } from './ai-store'

const READ_CHUNK_BYTES = 16 * 1024
const HEAD_READ_BYTES = 64 * 1024

export class BriefError extends Error {}

interface HeadRead {
  text: string
  hash: string
  mtimeMs: number
  truncated: boolean
}

function hasBriefExtension(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase()
  return (BRIEF_EXTENSIONS as readonly string[]).includes(extension)
}

function isInsideDir(candidate: string, dir: string): boolean {
  const relative = path.relative(dir, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

// Every read re-resolves the path. The folder the file lives in has to be a plain folder — a link in
// that chain means the bytes being read are not in the folder the user chose — and the resolved file
// has to land inside it. Both halves are needed: one stops a linked folder, the other a swapped file.
function resolvedFile(filePath: string): string {
  if (!path.isAbsolute(filePath)) throw new BriefError('A brief path has to be absolute.')
  const folder = path.dirname(filePath)
  const name = path.basename(filePath)
  if (realpathSync(folder) !== folder) {
    throw new BriefError(`"${name}" is reached through a link. A brief has to sit in a plain folder.`)
  }
  const real = realpathSync(filePath)
  if (!isInsideDir(real, folder)) throw new BriefError(`"${name}" points outside the folder it was linked from.`)
  if (!statSync(real).isFile()) throw new BriefError(`"${name}" is not a file.`)
  return real
}

function briefNameFromPath(filePath: string): string {
  const base = path.basename(filePath)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

// Only the head is ever read, so the hash covers what the model would see plus the file size:
// enough to notice a change without walking a large file on every look.
function readHead(filePath: string): HeadRead {
  const stat = statSync(filePath)
  const fd = openSync(filePath, 'r')
  const decoder = new StringDecoder('utf8')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES)
  const limit = Math.min(stat.size, HEAD_READ_BYTES)
  let text = ''
  let position = 0
  try {
    while (position < limit) {
      const wanted = Math.min(buffer.length, limit - position)
      const read = readSync(fd, buffer, 0, wanted, position)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
      position += read
      text += decoder.write(buffer.subarray(0, read))
    }
    hash.update(`|${stat.size}`)
  } finally {
    closeSync(fd)
  }
  const truncated = position < stat.size || text.length > BRIEF_MAX_CHARS
  const head = keepWholeCharacters(text.slice(0, BRIEF_MAX_CHARS))
  return {
    text: head,
    hash: hash.digest('hex'),
    mtimeMs: stat.mtimeMs,
    truncated,
  }
}

function keepWholeCharacters(text: string): string {
  const last = text.charCodeAt(text.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) return text.slice(0, -1)
  return text
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, BRIEF_SUMMARY_MAX_CHARS)
}

function frontMatter(lines: string[]): { summary: string | null; body: string[] } {
  if (lines[0]?.trim() !== '---') return { summary: null, body: lines }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== '---') continue
    const block = lines.slice(1, index)
    for (const line of block) {
      const match = /^\s*summary\s*:\s*(.*)$/.exec(line)
      if (!match) continue
      const value = match[1].trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
      if (value !== '') return { summary: value, body: lines.slice(index + 1) }
    }
    return { summary: null, body: lines.slice(index + 1) }
  }
  return { summary: null, body: lines }
}

// Deterministic and model-free, so the same file always gets the same one-line summary.
export function summarizeBrief(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const { summary, body } = frontMatter(lines)
  if (summary) return oneLine(summary)
  const headingAt = body.findIndex((line) => /^#{1,6}\s+\S/.test(line))
  const parts: string[] = []
  if (headingAt >= 0) parts.push(body[headingAt].replace(/^#{1,6}\s+/, '').trim())
  for (let index = headingAt + 1; index < body.length && parts.length < 2; index += 1) {
    const line = body[index].trim()
    if (line === '') continue
    parts.push(line)
    if (headingAt < 0) break
  }
  return oneLine(parts.join(': '))
}

function takenNames(): Set<string> {
  return new Set(listBriefs().map((brief) => brief.name))
}

function addBriefFile(filePath: string, taken: Set<string>): Brief {
  const name = briefNameFromPath(filePath)
  const invalid = briefNameError(name)
  if (invalid) throw new BriefError(invalid)
  if (briefNameTaken(name, taken)) throw new BriefError(`A brief named "${name}" is already linked.`)
  const read = readHead(filePath)
  const now = new Date().toISOString()
  const brief: Brief = {
    id: randomUUID(),
    name,
    filePath,
    summary: summarizeBrief(read.text),
    contentHash: read.hash,
    mtimeMs: read.mtimeMs,
    enabled: true,
    alwaysInclude: false,
    createdAt: now,
    updatedAt: now,
  }
  insertBrief(brief)
  taken.add(name)
  return brief
}

function requireFolder(folderPath: string): string {
  if (!path.isAbsolute(folderPath)) throw new BriefError('A folder path has to be absolute.')
  const real = realpathSync(folderPath)
  if (!statSync(real).isDirectory()) throw new BriefError('That is not a folder.')
  return real
}

// A folder scan skips what it cannot link: it is one gesture over a directory the user owns, and a
// single odd file should not cost them the other nineteen briefs.
export function linkFolder(folderPath: string): Brief[] {
  const root = requireFolder(folderPath)
  const taken = takenNames()
  const linked = new Set(listBriefs().map((brief) => brief.filePath))
  const added: Brief[] = []
  for (const entry of readdirSync(root).sort()) {
    if (!hasBriefExtension(entry)) continue
    const candidate = path.join(root, entry)
    try {
      const real = resolvedFile(candidate)
      if (linked.has(real) || briefNameTaken(briefNameFromPath(real), taken)) continue
      added.push(addBriefFile(real, taken))
    } catch (error) {
      if (error instanceof BriefError) continue
      throw error
    }
  }
  return added
}

// An explicit multi-file pick is one gesture, so it either all lands or nothing does: every path is
// resolved and checked before the first row is written.
export function linkFiles(filePaths: string[]): Brief[] {
  const taken = takenNames()
  const linked = new Map(listBriefs().map((brief) => [brief.filePath, brief.name]))
  const planned = new Set(taken)
  const targets: string[] = []
  for (const filePath of filePaths) {
    const real = resolvedFile(filePath)
    if (!hasBriefExtension(real)) throw new BriefError('A brief is a .md or .markdown file.')
    const existing = linked.get(real)
    if (existing !== undefined) throw new BriefError(`That file is already linked as "${existing}".`)
    const name = briefNameFromPath(real)
    const invalid = briefNameError(name)
    if (invalid) throw new BriefError(invalid)
    if (briefNameTaken(name, planned)) throw new BriefError(`A brief named "${name}" is already linked.`)
    planned.add(name)
    linked.set(real, name)
    targets.push(real)
  }
  return targets.map((real) => addBriefFile(real, taken))
}

export function briefErrorMessage(error: unknown): string {
  if (error instanceof BriefError) return error.message
  const code = (error as { code?: string }).code
  if (code === 'ENOENT') return 'The file is gone.'
  return `The file could not be read${code ? ` (${code})` : ''}.`
}

function viewOf(brief: Brief): BriefView {
  try {
    const read = readHead(resolvedFile(brief.filePath))
    return { ...brief, stale: read.hash !== brief.contentHash, truncated: read.truncated, unreadable: null }
  } catch (error) {
    return { ...brief, stale: false, truncated: false, unreadable: briefErrorMessage(error) }
  }
}

export function listBriefViews(): BriefView[] {
  return listBriefs().map(viewOf)
}

export function refreshBrief(id: string): Brief {
  const brief = getBrief(id)
  if (!brief) throw new BriefError('No such brief.')
  const read = readHead(resolvedFile(brief.filePath))
  return writeBriefRead(id, {
    summary: summarizeBrief(read.text),
    contentHash: read.hash,
    mtimeMs: read.mtimeMs,
    updatedAt: new Date().toISOString(),
  })
}

export interface BriefFile {
  name: string
  text: string
  truncated: boolean
}

// What the prompt builder is allowed to ask for: a live read of one enabled brief, or nothing.
export function readBriefFile(id: string): BriefFile | null {
  const brief = getBrief(id)
  if (!brief || !brief.enabled) return null
  try {
    const read = readHead(resolvedFile(brief.filePath))
    return { name: brief.name, text: read.text, truncated: read.truncated }
  } catch (error) {
    console.error('brief read', brief.name, briefErrorMessage(error))
    return null
  }
}
