import {
  defaultTheme,
  parseThemeDocument,
  samePalette,
  themeRuntimeCss,
  type Palette,
  type ThemeDocument,
  type ThemeMode,
  type ThemePreset,
  type ThemeToken,
} from '@shared/theme'

type Gesture = 'once' | 'move'

const listeners = new Set<() => void>()
const uiListeners = new Set<() => void>()

let doc: ThemeDocument = defaultTheme()
let snapshot: ThemeDocument = doc
let open = false
let editing: ThemeMode = 'light'
let error = ''
let exportText = ''
let dirty = false
let timer = 0
let gesture = false
const past: { light: Palette; dark: Palette }[] = []
const future: { light: Palette; dark: Palette }[] = []
let compareLock = false
let compareHold = false
let uiSnapshot = { open: false, editing: 'light' as ThemeMode, error: '', exportText: '', compare: false }

function emit(): void {
  snapshot = {
    ...doc,
    light: { ...doc.light },
    dark: { ...doc.dark },
    presets: doc.presets.map((preset) => ({ ...preset, light: { ...preset.light }, dark: { ...preset.dark } })),
  }
  for (const listener of listeners) listener()
}

function emitUi(): void {
  uiSnapshot = { open, editing, error, exportText, compare: compareLock || compareHold }
  for (const listener of uiListeners) listener()
}

export function getThemeSnapshot(): ThemeDocument {
  return snapshot
}

export function getThemeUi(): { open: boolean; editing: ThemeMode; error: string; exportText: string; compare: boolean } {
  return uiSnapshot
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function subscribeThemeUi(listener: () => void): () => void {
  uiListeners.add(listener)
  return () => uiListeners.delete(listener)
}

function paint(): void {
  const root = document.documentElement
  if (doc.followSystem) delete root.dataset.theme
  else root.dataset.theme = open ? editing : doc.mode
  let style = document.getElementById('branchlog-theme')
  if (!style) {
    style = document.createElement('style')
    style.id = 'branchlog-theme'
    ;(document.head ?? root).appendChild(style)
  }
  style.textContent = themeRuntimeCss(doc)
}

function remember(): void {
  past.push({ light: { ...doc.light }, dark: { ...doc.dark } })
  if (past.length > 50) past.shift()
  future.length = 0
}

function applyColors(light: Palette, dark: Palette, record: boolean): void {
  if (samePalette(light, doc.light) && samePalette(dark, doc.dark)) return
  if (record) remember()
  doc = { ...doc, light, dark }
  dirty = true
  error = ''
  paint()
  schedule()
  emit()
}

export function editToken(mode: ThemeMode, token: ThemeToken, hex: string, gestureKind: Gesture): void {
  if (doc[mode][token] === hex) return
  const record = gestureKind === 'once' || !gesture
  if (gestureKind === 'move') gesture = true
  const next = { ...doc[mode], [token]: hex }
  applyColors(mode === 'light' ? next : doc.light, mode === 'dark' ? next : doc.dark, record)
}

export function endGesture(): void {
  gesture = false
}

export function replacePalettes(light: Palette, dark: Palette, kind: 'once' | 'move' = 'once'): void {
  const record = kind === 'once' || !gesture
  if (kind === 'move') gesture = true
  else endGesture()
  applyColors(light, dark, record)
}

export function undoTheme(): void {
  const previous = past.pop()
  if (!previous) return
  future.push({ light: { ...doc.light }, dark: { ...doc.dark } })
  doc = { ...doc, light: previous.light, dark: previous.dark }
  dirty = true
  paint()
  schedule()
  emit()
}

export function redoTheme(): void {
  const next = future.pop()
  if (!next) return
  past.push({ light: { ...doc.light }, dark: { ...doc.dark } })
  doc = { ...doc, light: next.light, dark: next.dark }
  dirty = true
  paint()
  schedule()
  emit()
}

export function setEditing(mode: ThemeMode): void {
  editing = mode
  doc = { ...doc, mode, followSystem: false }
  dirty = true
  paint()
  schedule()
  emit()
  emitUi()
}

export function setFollowSystem(on: boolean): void {
  doc = { ...doc, followSystem: on }
  if (on) editing = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  dirty = true
  paint()
  schedule()
  emit()
  emitUi()
}

let lastToggle = 0
let openedAt = 0

export function toggleThemeLab(): void {
  const now = performance.now()
  if (now - lastToggle < 300) return
  lastToggle = now
  if (open) {
    if (now - openedAt < 800) return
    closeThemeLab()
    return
  }
  openThemeLab()
  openedAt = now
}

export function installThemeShortcut(): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process' || event.repeat) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      closeThemeLab()
      return
    }
    if (event.key.toLowerCase() !== 't' || event.altKey || !event.shiftKey) return
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    event.stopPropagation()
    toggleThemeLab()
  }
  document.addEventListener('keydown', onKey, true)
  return () => document.removeEventListener('keydown', onKey, true)
}

export function openThemeLab(): void {
  if (!doc.followSystem) editing = doc.mode
  else editing = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  open = true
  paint()
  emitUi()
}

export function closeThemeLab(): void {
  open = false
  compareHold = false
  compareLock = false
  endGesture()
  paint()
  flushTheme()
  emitUi()
}

function schedule(): void {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => flushTheme(), 200)
}

export function flushTheme(): void {
  window.clearTimeout(timer)
  timer = 0
  if (!dirty) return
  if (!('branchlog' in window)) return
  try {
    const wrote = window.branchlog.settings.setTheme(doc)
    if (!wrote.ok) {
      error = wrote.message || 'Could not save the theme.'
      emitUi()
      return
    }
  } catch (caught) {
    console.error(caught)
    error = 'Could not save the theme.'
    emitUi()
    return
  }
  dirty = false
}

export function loadTheme(): void {
  if (!('branchlog' in window)) return
  try {
    doc = parseThemeDocument(window.branchlog.settings.theme())
  } catch (caught) {
    console.error(caught)
    doc = defaultTheme()
    error = 'Could not read the saved theme.'
  }
  snapshot = doc
}

export function savePreset(name: string): void {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 40) {
    error = 'Name the theme with 1 to 40 characters.'
    emitUi()
    return
  }
  const preset: ThemePreset = {
    id: crypto.randomUUID(),
    name: trimmed,
    light: { ...doc.light },
    dark: { ...doc.dark },
  }
  doc = { ...doc, presets: [...doc.presets, preset] }
  dirty = true
  error = ''
  flushTheme()
  emit()
}

export function renamePreset(id: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 40) {
    error = 'Name the theme with 1 to 40 characters.'
    emitUi()
    return
  }
  doc = {
    ...doc,
    presets: doc.presets.map((preset) => (preset.id === id ? { ...preset, name: trimmed } : preset)),
  }
  dirty = true
  error = ''
  flushTheme()
  emit()
}

export function deletePreset(id: string): void {
  doc = { ...doc, presets: doc.presets.filter((preset) => preset.id !== id) }
  dirty = true
  error = ''
  flushTheme()
  emit()
}

export function loadPreset(id: string | 'default'): void {
  if (id === 'default') {
    replacePalettes(defaultTheme().light, defaultTheme().dark)
    return
  }
  const preset = doc.presets.find((item) => item.id === id)
  if (!preset) return
  replacePalettes(preset.light, preset.dark)
}

export function showCompare(hold: boolean): void {
  const saved = doc.presets[doc.presets.length - 1]
  if (!saved) return
  compareHold = hold
  paintCompare(saved)
  emitUi()
}

export function toggleCompare(): void {
  const saved = doc.presets[doc.presets.length - 1]
  if (!saved) return
  compareLock = !compareLock
  if (compareLock) paintCompare(saved)
  else paint()
  emitUi()
}

export function endCompareHold(): void {
  compareHold = false
  if (!compareLock) paint()
  emitUi()
}

function paintCompare(saved: ThemePreset): void {
  const style = document.getElementById('branchlog-theme')
  if (!style) return
  style.textContent = themeRuntimeCss({ ...doc, light: saved.light, dark: saved.dark })
}

export function setExportText(value: string): void {
  exportText = value
  emitUi()
}

if (typeof window !== 'undefined' && 'branchlog' in window) {
  loadTheme()
  window.branchlog.onMenuAction((action) => {
    if (action === 'theme-lab') toggleThemeLab()
  })
}
