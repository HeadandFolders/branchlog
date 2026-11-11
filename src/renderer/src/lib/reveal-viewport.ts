import { layoutIdle, reducedMotion } from './layout-motion'

const MARGIN_PX = 80
// New content arrives below or to the right, so only those edges keep the full
// breathing room. The day frames its first row about 28px inside the pane and that
// row is already fully visible, so the near edges just need a small clear zone.
const NEAR_PX = 24
const PAN_MS = 250
// A reveal waits for the layout settle, and for React Flow's first measurement of
// a brand-new node. Both always land within a frame or two; this only bounds the
// loop so a row that disappears mid-flight cannot keep it alive.
const MAX_WAIT_MS = 1000
const KEEP_OUT = '.theme-lab, .ai-settings'

interface Viewport {
  x: number
  y: number
  zoom: number
}

interface RevealHost {
  viewport: () => Viewport | null
  apply: (viewport: Viewport) => void
  pane: () => HTMLElement | null
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

interface Tween {
  from: Viewport
  to: Viewport
  started: number
}

let host: RevealHost | null = null
let waiting: { id: string; since: number } | null = null
let tween: Tween | null = null
let frame = 0

function schedule(): void {
  if (frame !== 0) return
  frame = requestAnimationFrame(tick)
}

function stop(): void {
  if (frame === 0) return
  cancelAnimationFrame(frame)
  frame = 0
}

function measure(id: string): Box | 'measuring' | 'gone' {
  const field = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
  if (!field) return 'gone'
  const node = field.closest<HTMLElement>('.react-flow__node')
  if (node && getComputedStyle(node).visibility === 'hidden') return 'measuring'
  const row = field.closest<HTMLElement>('.task-line') ?? field
  const rect = row.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return 'measuring'
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
}

function visibleArea(pane: DOMRect): Box {
  const far = Math.min(MARGIN_PX, pane.width / 4, pane.height / 4)
  const near = Math.min(NEAR_PX, pane.width / 8, pane.height / 8)
  const area: Box = {
    left: pane.left + near,
    right: pane.right - far,
    top: pane.top + near,
    bottom: pane.bottom - far,
  }
  for (const panel of document.querySelectorAll<HTMLElement>(KEEP_OUT)) {
    const rect = panel.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.bottom <= area.top || rect.top >= area.bottom) continue
    if (rect.left >= (pane.left + pane.right) / 2) area.right = Math.min(area.right, rect.left)
    else area.left = Math.max(area.left, rect.right)
  }
  if (area.right - area.left < near + far) {
    area.left = pane.left + near
    area.right = pane.right - far
  }
  return area
}

// How far the paper must slide so the whole row lands inside the area. The canvas
// moves with the viewport, so a row below the area needs a negative shift. Zero on
// an axis the row already fits, so a visible row never moves the canvas.
function shiftFor(box: Box, area: Box): { x: number; y: number } | null {
  let y = 0
  if (box.bottom > area.bottom) y = area.bottom - box.bottom
  else if (box.top < area.top) y = area.top - box.top
  let x = 0
  if (box.right > area.right) x = area.right - box.right
  else if (box.left < area.left) x = area.left - box.left
  if (x === 0 && y === 0) return null
  return { x, y }
}

function play(): void {
  const current = tween
  const currentHost = host
  if (!current || !currentHost) {
    tween = null
    return
  }
  const elapsed = performance.now() - current.started
  const progress = elapsed >= PAN_MS ? 1 : elapsed / PAN_MS
  const eased = 1 - (1 - progress) ** 3
  currentHost.apply({
    x: current.from.x + (current.to.x - current.from.x) * eased,
    y: current.from.y + (current.to.y - current.from.y) * eased,
    // The reveal only ever slides the paper. Whatever zoom the page is at stays.
    zoom: current.from.zoom,
  })
  if (progress < 1) schedule()
  else tween = null
}

function settle(): void {
  const request = waiting
  const currentHost = host
  if (!request) return
  if (!currentHost || performance.now() - request.since >= MAX_WAIT_MS) {
    waiting = null
    return
  }
  if (!layoutIdle()) {
    schedule()
    return
  }
  const box = measure(request.id)
  if (box === 'gone') {
    waiting = null
    return
  }
  if (box === 'measuring') {
    schedule()
    return
  }
  const viewport = currentHost.viewport()
  const pane = currentHost.pane()?.getBoundingClientRect()
  if (!viewport || !pane) {
    waiting = null
    return
  }
  waiting = null
  const shift = shiftFor(box, visibleArea(pane))
  if (!shift) return
  const target = { x: viewport.x + shift.x, y: viewport.y + shift.y, zoom: viewport.zoom }
  if (reducedMotion()) {
    currentHost.apply(target)
    return
  }
  tween = { from: viewport, to: target, started: performance.now() }
  schedule()
}

function tick(): void {
  frame = 0
  if (tween) {
    play()
    return
  }
  settle()
}

export function requestReveal(id: string): void {
  if (!host) return
  waiting = { id, since: performance.now() }
  // A newer reveal takes over from a pan still in flight, from wherever it is.
  tween = null
  schedule()
}

export function cancelReveal(): void {
  waiting = null
  tween = null
  stop()
}

export function revealIsBusy(): boolean {
  return waiting !== null || tween !== null
}

export function installReveal(next: RevealHost): () => void {
  host = next
  const pane = next.pane()
  const onCancel = (): void => {
    cancelReveal()
  }
  pane?.addEventListener('wheel', onCancel, { capture: true, passive: true })
  pane?.addEventListener('pointerdown', onCancel, { capture: true })
  window.__branchlogReveal = { busy: () => revealIsBusy() }
  return () => {
    cancelReveal()
    pane?.removeEventListener('wheel', onCancel, true)
    pane?.removeEventListener('pointerdown', onCancel, true)
    delete window.__branchlogReveal
    if (host === next) host = null
  }
}

declare global {
  interface Window {
    __branchlogReveal?: {
      busy: () => boolean
    }
  }
}
