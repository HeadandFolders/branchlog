import {
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  type Palette,
  type ThemeToken,
  defaultPalette,
} from './theme'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const byte = (value: number): string => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

export function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  return rgbToHex(
    a[0] * amount + b[0] * (1 - amount),
    a[1] * amount + b[1] * (1 - amount),
    a[2] * amount + b[2] * (1 - amount),
  )
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r0, g0, b0] = hexToRgb(hex).map((value) => value / 255) as [number, number, number]
  const max = Math.max(r0, g0, b0)
  const min = Math.min(r0, g0, b0)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r0) h = (g0 - b0) / d + (g0 < b0 ? 6 : 0)
  else if (max === g0) h = (b0 - r0) / d + 2
  else h = (r0 - g0) / d + 4
  return { h: h * 60, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 100) / 100
  const lig = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lig - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

function finish(palette: Palette, mode: 'light' | 'dark'): Palette {
  const next = { ...palette }
  next.edge = next.line
  next['edge-hover'] = mixHex(next.text, next.line, 0.45)
  next['edge-ai'] = next['ai-line']
  next['check-border'] = mixHex(next.text, next.bg, 0.58)
  next['focus-ring'] = next.text
  next['accent-dot'] = next.text
  next['accent-dot-rest'] = mixHex(next.text, next.bg, 0.6)
  next['active-1'] = next.ai
  next.selection = mixHex(next.text, next.line, mode === 'light' ? 0.55 : 0.45)
  next['selection-fill'] = mixHex(next['bg-subtle'], next.bg, 0.5)
  return next
}

export function randomPalettes(hue: number): { light: Palette; dark: Palette } {
  const base = ((hue % 360) + 360) % 360
  const aiHue = (base + 168) % 360
  const light = finish(
    {
      ...defaultPalette('light'),
      bg: hslToHex(base, 8, 95),
      'bg-subtle': hslToHex(base, 8, 92),
      text: hslToHex(base, 6, 10),
      'text-muted': hslToHex(base, 4, 54),
      'text-faint': hslToHex(base, 4, 73),
      line: hslToHex(base, 6, 84),
      'active-0': hslToHex(base, 7, 89),
      ai: hslToHex(aiHue, 40, 31),
      'ai-soft': hslToHex(aiHue, 28, 92),
      'ai-line': hslToHex(aiHue, 28, 68),
    },
    'light',
  )
  const dark = finish(
    {
      ...defaultPalette('dark'),
      bg: hslToHex(base, 6, 8),
      'bg-subtle': hslToHex(base, 5, 13),
      text: hslToHex(base, 8, 92),
      'text-muted': hslToHex(base, 4, 62),
      'text-faint': hslToHex(base, 3, 42),
      line: hslToHex(base, 4, 24),
      'active-0': hslToHex(base, 4, 16),
      ai: hslToHex(aiHue, 38, 62),
      'ai-soft': hslToHex(aiHue, 28, 16),
      'ai-line': hslToHex(aiHue, 28, 42),
    },
    'dark',
  )
  return { light, dark }
}

export function accentFromHue(palette: Palette, hue: number): Palette {
  const next = { ...palette }
  const ai = hexToHsl(palette.ai)
  const soft = hexToHsl(palette['ai-soft'])
  const line = hexToHsl(palette['ai-line'])
  next.ai = hslToHex(hue, Math.max(ai.s, 28), ai.l)
  next['ai-soft'] = hslToHex(hue, Math.max(soft.s, 16), soft.l)
  next['ai-line'] = hslToHex(hue, Math.max(line.s, 18), line.l)
  next['edge-ai'] = next['ai-line']
  next['active-1'] = next.ai
  return next
}

export function swapped(light: Palette, dark: Palette): { light: Palette; dark: Palette } {
  return { light: { ...dark }, dark: { ...light } }
}

export function tokenChanged(mode: 'light' | 'dark', token: ThemeToken, value: string): boolean {
  const defaults = mode === 'light' ? DEFAULT_LIGHT : DEFAULT_DARK
  return value !== defaults[token]
}
