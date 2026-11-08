import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const colorPattern = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(|hsla?\(/g

const allowFiles = [
  path.normalize('src/shared/theme.ts'),
  path.normalize('src/renderer/src/styles/globals.css'),
  path.normalize('src/renderer/src/styles/theme-lab.css'),
]

function walk(dir: string, found: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'out') continue
      walk(full, found)
    } else if (/\.(css|ts|tsx)$/.test(name)) found.push(full)
  }
}

function colorsIn(file: string): string[] {
  return readFileSync(file, 'utf8').match(colorPattern) ?? []
}

test('renderer source and built css keep colors on tokens', () => {
  const allowed = new Set<string>()
  for (const file of allowFiles) {
    for (const color of colorsIn(file)) allowed.add(color.toLowerCase())
  }
  const renderer: string[] = []
  walk(path.join('src', 'renderer'), renderer)
  const sourceHits: string[] = []
  for (const file of renderer) {
    const relative = path.normalize(path.relative(process.cwd(), file))
    if (allowFiles.includes(relative)) continue
    for (const color of colorsIn(file)) sourceHits.push(`${relative}: ${color}`)
  }
  expect(sourceHits).toEqual([])

  const builtDir = path.join('out', 'renderer', 'assets')
  const builtHits: string[] = []
  for (const name of readdirSync(builtDir)) {
    if (!name.endsWith('.css')) continue
    const text = readFileSync(path.join(builtDir, name), 'utf8')
    for (const color of text.match(colorPattern) ?? []) {
      const value = color.toLowerCase()
      if (value === '#0000' || value === '#00000000') continue
      const at = text.indexOf(color)
      const around = at >= 0 ? text.slice(Math.max(0, at - 12), at + color.length + 8) : ''
      if (/rgb\(from|hsl\(from/.test(around)) continue
      if (!allowed.has(value)) builtHits.push(`${name}: ${color}`)
    }
  }
  expect(builtHits).toEqual([])
})
