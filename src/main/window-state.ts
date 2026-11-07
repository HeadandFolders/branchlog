import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

const DEFAULT_STATE: WindowState = {
  width: 1280,
  height: 800,
  isMaximized: false,
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function intersectionArea(a: Rectangle, b: Rectangle): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function isOnScreen(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => intersectionArea(bounds, display.workArea) > 0)
}

export function loadWindowState(): WindowState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_STATE
    const record = parsed as Record<string, unknown>
    const width = isFiniteNumber(record.width) ? Math.round(record.width) : DEFAULT_STATE.width
    const height = isFiniteNumber(record.height) ? Math.round(record.height) : DEFAULT_STATE.height
    if (width < 900 || height < 600 || width > 8000 || height > 8000) return DEFAULT_STATE
    const state: WindowState = {
      width,
      height,
      isMaximized: record.isMaximized === true,
    }
    if (isFiniteNumber(record.x) && isFiniteNumber(record.y)) {
      const bounds = { x: Math.round(record.x), y: Math.round(record.y), width, height }
      if (isOnScreen(bounds)) {
        state.x = bounds.x
        state.y = bounds.y
      }
    }
    return state
  } catch {
    return DEFAULT_STATE
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const saveSoon = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => saveNow(win), 300)
  }
  win.on('resize', saveSoon)
  win.on('move', saveSoon)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    saveNow(win)
  })
}

function saveNow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const isMaximized = win.isMaximized()
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  }
  const file = statePath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state))
}
