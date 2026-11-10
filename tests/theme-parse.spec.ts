import { expect, test } from '@playwright/test'
import {
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  parseThemeDocument,
  parseThemeExchange,
  THEME_TOKENS,
  type ThemeToken,
} from '../src/shared/theme'

const ADDED_AFTER_TASK_STATES: ThemeToken[] = ['carried', 'carried-strong', 'finished-later', 'dropped']

/** The palette a notebook holds when it was last saved before the task-state tokens existed. */
const OLD_LIGHT: Record<string, string> = {
  bg: '#123456',
  'bg-subtle': '#ecece7',
  text: '#1a1a1a',
  'text-muted': '#8a8a85',
  'text-faint': '#b8b8b2',
  line: '#d9d9d3',
  edge: '#d9d9d3',
  'edge-hover': '#838380',
  'edge-ai': '#9cc2be',
  'check-border': '#757573',
  selection: '#3178e0',
  'selection-fill': '#e0e7ed',
  'focus-ring': '#1a1a1a',
  ai: '#2f6f6a',
  'ai-soft': '#e4efee',
  'ai-line': '#9cc2be',
  'accent-dot': '#1a1a1a',
  'accent-dot-rest': '#71716f',
  'active-0': '#e6e6e0',
  'active-1': '#2f6f6a',
}

const OLD_DARK: Record<string, string> = { ...DEFAULT_DARK }
for (const token of ADDED_AFTER_TASK_STATES) delete OLD_DARK[token]

function oldDocument(prefs: Record<string, string> = {}): Record<string, unknown> {
  return {
    followSystem: true,
    mode: 'light',
    presets: [],
    light: { ...OLD_LIGHT, ...prefs },
    dark: { ...OLD_DARK },
  }
}

test('a theme row without the task-state tokens keeps its own colors and defaults only the missing ones', () => {
  const doc = parseThemeDocument(oldDocument())
  expect(doc.light.bg).toBe('#123456')
  expect(doc.light.ai).toBe(DEFAULT_LIGHT.ai)
  for (const token of ADDED_AFTER_TASK_STATES) {
    expect(doc.light[token]).toBe(DEFAULT_LIGHT[token])
    expect(doc.dark[token]).toBe(DEFAULT_DARK[token])
  }
  expect(THEME_TOKENS.every((token) => doc.light[token].startsWith('#'))).toBe(true)
})

test('a theme row written with css token names loads the same way', () => {
  const dashed: Record<string, string> = {}
  for (const [key, value] of Object.entries(OLD_LIGHT)) dashed[`--${key}`] = value
  const doc = parseThemeDocument({ followSystem: false, mode: 'light', presets: [], light: dashed, dark: OLD_DARK })
  expect(doc.mode).toBe('light')
  expect(doc.light.bg).toBe('#123456')
  expect(doc.light.carried).toBe(DEFAULT_LIGHT.carried)
})

test('a stored theme still round trips through the parser unchanged', () => {
  const first = parseThemeDocument(oldDocument())
  const second = parseThemeDocument({ ...first, presets: [] })
  expect(second.light).toEqual(first.light)
  expect(second.dark).toEqual(first.dark)
})

test('an import missing the newest tokens takes them from the defaults', () => {
  const exchanged = parseThemeExchange(JSON.stringify({ light: OLD_LIGHT, dark: OLD_DARK }))
  expect(exchanged.light['carried-strong']).toBe(DEFAULT_LIGHT['carried-strong'])
  expect(exchanged.dark.dropped).toBe(DEFAULT_DARK.dropped)
})

test('a broken color, an unknown token and an empty palette are still rejected', () => {
  expect(() => parseThemeDocument(oldDocument({ bg: 'red' }))).toThrow('Invalid color for --bg')
  expect(() => parseThemeDocument(oldDocument({ bg: '#12345' }))).toThrow('Invalid color for --bg')
  expect(() => parseThemeDocument({ ...oldDocument(), light: { ...OLD_LIGHT, halo: '#ff0000' } })).toThrow(
    'Unknown color token --halo',
  )
  expect(() => parseThemeDocument({ ...oldDocument(), light: {} })).toThrow('Invalid theme JSON')
  expect(() => parseThemeExchange('{"light":{"bg":"red"},"dark":{"bg":"#000000"}}')).toThrow('Invalid color for --bg')
})
