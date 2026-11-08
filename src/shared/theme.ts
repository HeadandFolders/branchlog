export const THEME_TOKENS = [
  'bg',
  'bg-subtle',
  'text',
  'text-muted',
  'text-faint',
  'line',
  'edge',
  'edge-hover',
  'edge-ai',
  'check-border',
  'selection',
  'selection-fill',
  'focus-ring',
  'ai',
  'ai-soft',
  'ai-line',
  'accent-dot',
  'accent-dot-rest',
  'active-0',
  'active-1',
] as const

export type ThemeToken = (typeof THEME_TOKENS)[number]
export type Palette = Record<ThemeToken, string>
export type ThemeMode = 'light' | 'dark'

export interface ThemePreset {
  id: string
  name: string
  light: Palette
  dark: Palette
}

export interface ThemeDocument {
  followSystem: boolean
  mode: ThemeMode
  light: Palette
  dark: Palette
  presets: ThemePreset[]
}

export const THEME_GROUPS: { label: string; tokens: ThemeToken[] }[] = [
  { label: 'Surfaces', tokens: ['bg', 'bg-subtle', 'active-0', 'selection-fill'] },
  { label: 'Text', tokens: ['text', 'text-muted', 'text-faint'] },
  { label: 'Lines', tokens: ['line', 'edge', 'edge-hover', 'check-border', 'selection', 'focus-ring'] },
  { label: 'AI', tokens: ['ai', 'ai-soft', 'ai-line', 'edge-ai', 'active-1'] },
  { label: 'Accent', tokens: ['accent-dot', 'accent-dot-rest'] },
]

export const CONTRAST_PAIRS: { id: string; label: string; fg: ThemeToken; bg: ThemeToken }[] = [
  { id: 'text-bg', label: 'Text on background', fg: 'text', bg: 'bg' },
  { id: 'muted-bg', label: 'Muted text on background', fg: 'text-muted', bg: 'bg' },
  { id: 'faint-bg', label: 'Faint text on background', fg: 'text-faint', bg: 'bg' },
  { id: 'ai-bg', label: 'AI on background', fg: 'ai', bg: 'bg' },
  { id: 'ai-soft', label: 'AI on AI soft', fg: 'ai', bg: 'ai-soft' },
  { id: 'text-subtle', label: 'Text on subtle background', fg: 'text', bg: 'bg-subtle' },
]

const HEX = /^#[0-9a-f]{6}$/

export const DEFAULT_LIGHT: Palette = {
  bg: '#f3f3ef',
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

export const DEFAULT_DARK: Palette = {
  bg: '#161614',
  'bg-subtle': '#232320',
  text: '#edede8',
  'text-muted': '#9c9c96',
  'text-faint': '#6a6a64',
  line: '#3a3a36',
  edge: '#3a3a36',
  'edge-hover': '#8b8b86',
  'edge-ai': '#4e7f7a',
  'check-border': '#93938f',
  selection: '#a4a4b4',
  'selection-fill': '#242424',
  'focus-ring': '#edede8',
  ai: '#7fbfb8',
  'ai-soft': '#1c3330',
  'ai-line': '#4e7f7a',
  'accent-dot': '#edede8',
  'accent-dot-rest': '#979793',
  'active-0': '#2a2a26',
  'active-1': '#7fbfb8',
}

const DEFAULTS: Record<ThemeMode, Palette> = { light: DEFAULT_LIGHT, dark: DEFAULT_DARK }

export function defaultTheme(): ThemeDocument {
  return {
    followSystem: true,
    mode: 'light',
    light: { ...DEFAULT_LIGHT },
    dark: { ...DEFAULT_DARK },
    presets: [],
  }
}

export function defaultPalette(mode: ThemeMode): Palette {
  return { ...DEFAULTS[mode] }
}

export function isHex(value: string): boolean {
  return HEX.test(value)
}

export function normalizeHex(value: string): string {
  return value.trim().toLowerCase()
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

export function parsePalette(value: unknown, message = 'Invalid theme JSON'): Palette {
  const record = requireRecord(value, message)
  const palette = {} as Palette
  for (const token of THEME_TOKENS) {
    const raw = record[token] ?? record[`--${token}`]
    if (typeof raw !== 'string' || !isHex(normalizeHex(raw))) {
      throw new Error(`Invalid color for --${token}`)
    }
    palette[token] = normalizeHex(raw)
  }
  const allowed = new Set<string>(THEME_TOKENS)
  for (const key of Object.keys(record)) {
    const name = key.startsWith('--') ? key.slice(2) : key
    if (!allowed.has(name)) throw new Error(`Unknown color token --${name}`)
  }
  return palette
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true
  }
  return false
}

function parsePreset(value: unknown): ThemePreset {
  const record = requireRecord(value, 'Invalid theme JSON')
  if (typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.id)) throw new Error('Invalid theme JSON')
  if (typeof record.name !== 'string') throw new Error('Invalid theme JSON')
  const name = record.name.trim()
  if (name.length < 1 || name.length > 40 || hasControl(name)) throw new Error('Invalid theme JSON')
  return { id: record.id.toLowerCase(), name, light: parsePalette(record.light), dark: parsePalette(record.dark) }
}

export function parseThemeDocument(value: unknown): ThemeDocument {
  const record = requireRecord(value, 'Invalid theme JSON')
  if (typeof record.followSystem !== 'boolean') throw new Error('Invalid theme JSON')
  if (record.mode !== 'light' && record.mode !== 'dark') throw new Error('Invalid theme JSON')
  if (!Array.isArray(record.presets) || record.presets.length > 30) throw new Error('Invalid theme JSON')
  return {
    followSystem: record.followSystem,
    mode: record.mode,
    light: parsePalette(record.light),
    dark: parsePalette(record.dark),
    presets: record.presets.map(parsePreset),
  }
}

export function parseThemeExchange(value: unknown): { light: Palette; dark: Palette } {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('Invalid theme JSON')
    }
  }
  const record = requireRecord(parsed, 'Invalid theme JSON')
  return { light: parsePalette(record.light), dark: parsePalette(record.dark) }
}

export function samePalette(a: Palette, b: Palette): boolean {
  return THEME_TOKENS.every((token) => a[token] === b[token])
}

export function paletteBlock(palette: Palette): string {
  return THEME_TOKENS.map((token) => `  --${token}: ${palette[token]};`).join('\n')
}

export function themeToCss(light: Palette, dark: Palette): string {
  return `:root {\n${paletteBlock(light)}\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n${paletteBlock(dark)}\n  }\n}\n`
}

export function themeToJson(light: Palette, dark: Palette): string {
  return JSON.stringify({ light, dark }, null, 2)
}

export function themeRuntimeCss(doc: ThemeDocument): string {
  const light = paletteBlock(doc.light).replace(/^  /gm, '    ')
  const dark = paletteBlock(doc.dark).replace(/^  /gm, '    ')
  return [
    `html:root {\n${light}\n    color-scheme: light;\n  }`,
    `@media (prefers-color-scheme: dark) {\n    html:root:not([data-theme="light"]) {\n${dark}\n      color-scheme: dark;\n    }\n  }`,
    `html:root[data-theme="dark"] {\n${dark}\n    color-scheme: dark;\n  }`,
    `html:root[data-theme="light"] {\n${light}\n    color-scheme: light;\n  }`,
    'html, body, #root { background: var(--bg); color: var(--text); }',
  ].join('\n')
}

export function themeBackground(doc: ThemeDocument, systemDark: boolean): string {
  const mode = doc.followSystem ? (systemDark ? 'dark' : 'light') : doc.mode
  return doc[mode].bg
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function contrastRatio(foreground: string, background: string): number {
  const lum = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16)
    const r = channel((n >> 16) & 255)
    const g = channel((n >> 8) & 255)
    const b = channel(n & 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const a = lum(foreground)
  const b = lum(background)
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

export function formatRatio(ratio: number): string {
  return ratio.toFixed(2)
}

export function passesAa(ratio: number): boolean {
  return ratio >= 4.5
}
