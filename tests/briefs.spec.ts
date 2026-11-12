import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { BRIEF_MAX_CHARS, BRIEF_SUMMARY_MAX_CHARS } from '../src/shared/ai-briefs.ts'
import { closeDatabase, initDatabase } from '../src/main/database.ts'
import { getBrief, listBriefs, setBriefAlwaysInclude, setBriefEnabled } from '../src/main/ai-store.ts'
import {
  briefErrorMessage,
  linkFiles,
  linkFolder,
  listBriefViews,
  readBriefFile,
  refreshBrief,
  summarizeBrief,
} from '../src/main/briefs.ts'

const dirs: string[] = []

interface Workspace {
  root: string
  notes: string
  outside: string
  file: (name: string) => string
}

// Everything the briefs module reads lives under one temp folder, so the symlink tests have a real
// outside to try to reach.
function workspace(): Workspace {
  const root = mkdtempSync(path.join(tmpdir(), 'branchlog-briefs-'))
  dirs.push(root)
  initDatabase(root)
  const notes = path.join(root, 'notes')
  const outside = path.join(root, 'outside')
  mkdirSync(notes)
  mkdirSync(outside)
  return {
    root,
    notes,
    outside,
    file: (name: string) => path.join(notes, name),
  }
}

function write(folder: string, name: string, text: string): string {
  const target = path.join(folder, name)
  writeFileSync(target, text, 'utf8')
  return target
}

function makeFolderLink(target: string, linkPath: string): void {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

function names(): string[] {
  return listBriefs().map((brief) => brief.name)
}

function paths(): string[] {
  return listBriefs().map((brief) => brief.filePath)
}

test.afterEach(() => {
  closeDatabase()
})

test.afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

test('a folder link takes the markdown files one level deep and leaves the rest alone', () => {
  const box = workspace()
  write(box.notes, 'alpha.md', '# Alpha\nfirst note')
  write(box.notes, 'beta.markdown', '# Beta\nsecond note')
  write(box.notes, 'upper.MD', '# Upper\nuppercase extension')
  write(box.notes, 'notes.txt', 'not a brief')
  write(box.notes, 'todo', 'no extension at all')
  mkdirSync(path.join(box.notes, 'deeper'))
  write(path.join(box.notes, 'deeper'), 'inner.md', '# Inner\ntwo levels deep')

  const added = linkFolder(box.notes)

  expect(added.map((brief) => brief.name).sort()).toEqual(['alpha', 'beta', 'upper'])
  expect(names().sort()).toEqual(['alpha', 'beta', 'upper'])
  expect(paths().every((one) => one.startsWith(box.notes))).toBe(true)
  // One level deep only: the scan never walks into a subfolder.
  expect(names()).not.toContain('inner')
})

test('linked files keep their name, path and summary in the row', () => {
  const box = workspace()
  write(box.notes, 'alpha.md', '---\nsummary: How the canvas works\n---\n# Alpha\nbody')

  const [brief] = linkFiles([box.file('alpha.md')])

  expect(brief.name).toBe('alpha')
  expect(brief.filePath).toBe(box.file('alpha.md'))
  expect(brief.summary).toBe('How the canvas works')
  expect(brief.enabled).toBe(true)
  expect(brief.alwaysInclude).toBe(false)
  expect(brief.contentHash).toMatch(/^[0-9a-f]{64}$/)
  expect(brief.mtimeMs).toBeGreaterThan(0)
  expect(brief.createdAt).toBe(brief.updatedAt)
})

test('the summary is front matter, else the first heading and the line after it, capped at 200', () => {
  expect(summarizeBrief('---\nsummary: "Written by hand"\n---\n# Heading\nignored')).toBe('Written by hand')
  expect(summarizeBrief('# The canvas\n\nRows sit on an infinite page.\nMore text.')).toBe(
    'The canvas: Rows sit on an infinite page.',
  )
  expect(summarizeBrief('No heading in this file\nsecond line')).toBe('No heading in this file')
  expect(summarizeBrief('')).toBe('')
  expect(summarizeBrief('   \n  \n')).toBe('')

  const long = `# Title\n\n${'a'.repeat(400)}`
  expect(summarizeBrief(long)).toHaveLength(BRIEF_SUMMARY_MAX_CHARS)

  // Quotes come off and the whitespace of a value collapses into one line.
  expect(summarizeBrief('---\nsummary:   "  spaced   out  "\n---\n# H')).toBe('spaced out')
})

test('a file past the per-brief cap keeps its head and says it is truncated', () => {
  const box = workspace()
  const body = `${'x'.repeat(BRIEF_MAX_CHARS + 3)}\nEND OF FILE`
  write(box.notes, 'long.md', `# Long\n${body}`)
  write(box.notes, 'short.md', '# Short\njust enough to read')

  const long = linkFiles([box.file('long.md')])[0]
  linkFiles([box.file('short.md')])

  const byName = new Map(listBriefViews().map((view) => [view.name, view]))
  expect(byName.get('long')?.truncated).toBe(true)
  expect(byName.get('short')?.truncated).toBe(false)

  const read = readBriefFile(long.id)
  expect(read?.truncated).toBe(true)
  expect(read?.text.length).toBe(BRIEF_MAX_CHARS)
  expect(read?.text.startsWith('# Long')).toBe(true)
  expect(read?.text).not.toContain('END OF FILE')
})

test('stale is the hash saying the file moved, and a re-read makes it current again', () => {
  const box = workspace()
  write(box.notes, 'alpha.md', '# Alpha\nthe first version')
  const [brief] = linkFiles([box.file('alpha.md')])

  expect(listBriefViews()[0].stale).toBe(false)

  write(box.notes, 'alpha.md', '# Alpha\nthe second version')

  const stale = listBriefViews()[0]
  expect(stale.stale).toBe(true)
  // The row still carries what the model was told last, until the person asks for a re-read.
  expect(stale.summary).toBe('Alpha: the first version')

  const refreshed = refreshBrief(brief.id)
  expect(refreshed.summary).toBe('Alpha: the second version')
  expect(refreshed.contentHash).not.toBe(brief.contentHash)
  expect(listBriefViews()[0].stale).toBe(false)
})

test('a file that has gone is a plain note in the list, not a throw', () => {
  const box = workspace()
  write(box.notes, 'alpha.md', '# Alpha\ngone soon')
  const [brief] = linkFiles([box.file('alpha.md')])
  unlinkSync(box.file('alpha.md'))

  const [view] = listBriefViews()
  expect(view.stale).toBe(false)
  expect(view.unreadable).toBe('The file is gone.')
  expect(readBriefFile(brief.id)).toBeNull()
})

test('a relative path, a missing file, a wrong extension and a taken name are refused', () => {
  const box = workspace()
  write(box.notes, 'alpha.md', '# Alpha\nplain text')
  write(box.notes, 'notes.txt', '# Alpha\nnot markdown')

  expect(() => linkFiles(['notes/alpha.md'])).toThrow(/absolute/)
  expect(() => linkFiles([path.join(box.root, 'nope', 'alpha.md')])).toThrow()
  expect(() => linkFiles([box.file('notes.txt')])).toThrow(/\.md or \.markdown/)
  expect(() => linkFiles([box.file('alpha.md'), box.file('alpha.md')])).toThrow(/already linked/)

  // A pick that is refused halfway writes nothing, so the good file in it is not silently left over.
  write(box.notes, 'gamma.md', '# Gamma\nthe good half of a mixed pick')
  expect(() => linkFiles([box.file('gamma.md'), box.file('notes.txt')])).toThrow(/\.md or \.markdown/)
  expect(names()).toEqual([])

  linkFiles([box.file('alpha.md')])
  expect(() => linkFiles([box.file('alpha.md')])).toThrow(/already linked as "alpha"/)

  // Names are unique ignoring case, so the same basename from another folder still collides.
  mkdirSync(path.join(box.root, 'other'))
  write(path.join(box.root, 'other'), 'alpha.md', '# Alpha again\nsecond copy')
  expect(() => linkFiles([path.join(box.root, 'other', 'alpha.md')])).toThrow(/already linked/)

  let caught: unknown
  try {
    linkFiles([path.join(box.root, 'missing.md')])
  } catch (error) {
    caught = error
  }
  expect(briefErrorMessage(caught)).toBe('The file is gone.')
})

test('the request-row name r is reserved, case-insensitively', () => {
  const box = workspace()
  write(box.notes, 'r.md', '# R\na brief that may not be named r')
  write(box.notes, 'alpha.md', '# Alpha\nplain')

  expect(() => linkFiles([box.file('r.md')])).toThrow(/reserved/)
  // A folder scan skips what it cannot link instead of losing the rest.
  expect(linkFolder(box.notes).map((brief) => brief.name)).toEqual(['alpha'])
  expect(names()).toEqual(['alpha'])
})

test('a brief reached through a linked folder is refused on every path to it', () => {
  const box = workspace()
  write(box.outside, 'secret.md', '# Secret\noutside the folder the user chose')
  write(box.notes, 'alpha.md', '# Alpha\nplain')
  makeFolderLink(box.outside, path.join(box.notes, 'link'))

  // Linking it directly.
  expect(() => linkFiles([path.join(box.notes, 'link', 'secret.md')])).toThrow(/link/)
  // The same file reached from a folder scan: the entry is skipped, the real brief still lands.
  expect(linkFolder(box.notes).map((brief) => brief.name)).toEqual(['alpha'])
  expect(paths()).not.toContain(path.join(box.outside, 'secret.md'))

  // A file swapped for a link that points at another folder.
  makeFolderLink(box.outside, path.join(box.notes, 'swapped.md'))
  expect(() => linkFiles([path.join(box.notes, 'swapped.md')])).toThrow(/points outside/)
})

test('a linked brief whose folder is later swapped for a link stops being readable', () => {
  const box = workspace()
  const inside = path.join(box.notes, 'inside')
  mkdirSync(inside)
  write(inside, 'alpha.md', '# Alpha\nreadable for now')

  linkFiles([path.join(inside, 'alpha.md')])
  expect(listBriefViews()[0].unreadable).toBeNull()

  rmSync(inside, { recursive: true, force: true })
  makeFolderLink(box.outside, inside)

  const [view] = listBriefViews()
  expect(view.stale).toBe(false)
  expect(view.unreadable).toMatch(/link/)
  expect(readBriefFile(listBriefs()[0].id)).toBeNull()
})

test('enable and always-include are the two switches the assembly reads', () => {
  const box = workspace()
  write(box.notes, 'alpha.md', '# Alpha\nfirst')
  write(box.notes, 'beta.md', '# Beta\nsecond')
  linkFolder(box.notes)
  const [alpha, beta] = listBriefs()

  setBriefAlwaysInclude(alpha.id, true)
  expect(listBriefs().map((brief) => brief.alwaysInclude)).toEqual([true, false])
  expect(getBrief(beta.id)?.alwaysInclude).toBe(false)

  // Switching use off leaves the other switch alone; assembly needs both to include a brief.
  setBriefEnabled(alpha.id, false)
  expect(listBriefs().map((brief) => [brief.name, brief.enabled, brief.alwaysInclude])).toEqual([
    ['alpha', false, true],
    ['beta', true, false],
  ])
})
