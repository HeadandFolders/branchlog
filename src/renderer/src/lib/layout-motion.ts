import { separateNearby, type SeparateBody, type SeparateMove } from '@shared/separate'
import { armLayoutHistory } from '../store/history'
import { registerLayoutBridge } from '../store/layout-bridge'

const EASE_MS = 280
const MAX_MS = 1000

interface Point {
  x: number
  y: number
}

interface Session {
  changedId: string
  live: boolean
  deferred: boolean
  unsaved: boolean
  stamp: number
  from: Map<string, Point>
  targets: Map<string, Point>
  started: number
}

export interface LayoutHost {
  bodies: (changedId: string) => SeparateBody[]
  positions: () => Map<string, Point>
  apply: (positions: ReadonlyMap<string, Point>) => void
  reset: () => void
  commit: (moves: readonly SeparateMove[], alsoId: string | null) => void
  enabled: () => boolean
}

let host: LayoutHost | null = null
let session: Session | null = null
let applied: Map<string, Point> | null = null
let frame = 0
let generation = 0
let restoreEpoch = 0
let sizeEpoch = 0
const sizeSeen = new Map<string, number>()
const sizes = new Map<string, { width: number; height: number }>()

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function cancelFrame(): void {
  if (frame === 0) return
  cancelAnimationFrame(frame)
  frame = 0
}

function shownPositions(): Map<string, Point> {
  return host?.positions() ?? new Map()
}

function play(now: number): void {
  const current = session
  if (!current || !host) return
  const elapsed = now - current.started
  const limit = reducedMotion() || elapsed >= MAX_MS
  const t = limit ? 1 : Math.min(1, elapsed / EASE_MS)
  const eased = 1 - (1 - t) ** 3
  const next = new Map<string, Point>()
  for (const [id, target] of current.targets) {
    const start = current.from.get(id) ?? target
    next.set(id, {
      x: start.x + (target.x - start.x) * eased,
      y: start.y + (target.y - start.y) * eased,
    })
  }
  applied = next
  host.apply(next)
  if (t < 1) {
    frame = requestAnimationFrame(play)
    return
  }
  frame = 0
  applied = current.targets
  host.apply(current.targets)
  if (current.live) return
  const finished = current
  session = null
  applied = null
  generation += 1
  host.commit(
    [...finished.targets].map(([id, point]) => ({ id, ...point })),
    finished.unsaved ? finished.changedId : null,
  )
}

function startEase(next: Session): void {
  cancelFrame()
  session = next
  if (reducedMotion()) {
    play(next.started + MAX_MS)
    return
  }
  frame = requestAnimationFrame(play)
}

function targetsFrom(changedId: string, pinned: boolean): Map<string, Point> | null {
  if (!host) return null
  const bodies = host.bodies(changedId).map((body) => (body.id === changedId ? { ...body, pinned } : body))
  const moves = separateNearby(bodies, changedId)
  if (moves.length === 0) return null
  return new Map(moves.map((move) => [move.id, { x: move.x, y: move.y }]))
}

function begin(changedId: string, pinned: boolean, live: boolean): void {
  if (!host || !host.enabled()) return
  const targets = targetsFrom(changedId, pinned)
  if (!targets) {
    if (session?.changedId === changedId && session.live) return
    return
  }
  const from = shownPositions()
  startEase({
    changedId,
    live,
    deferred: false,
    unsaved: false,
    stamp: live ? 0 : armLayoutHistory(),
    from,
    targets,
    started: performance.now(),
  })
}

function finishSession(commit: boolean): void {
  const current = session
  if (!current || !host) return
  cancelFrame()
  session = null
  applied = null
  if (!commit) {
    host.reset()
    generation += 1
    return
  }
  host.apply(current.targets)
  generation += 1
  if (!current.live) host.commit([...current.targets].map(([id, point]) => ({ id, ...point })), current.unsaved ? current.changedId : null)
}

export function engageLayout(changedId: string, pinned: boolean): void {
  begin(changedId, pinned, false)
}

export function liveLayout(changedId: string): void {
  begin(changedId, true, true)
}

export function heldPositions(): ReadonlyMap<string, Point> | null {
  return session ? applied : null
}

export function layoutIdle(): boolean {
  return session === null && frame === 0
}

export function layoutGeneration(): number {
  return generation
}

export function finishLayoutNow(): void {
  if (!session) return
  const current = session
  if (current.live && !current.deferred) {
    finishSession(false)
    return
  }
  if (current.live) current.live = false
  if (current.stamp === 0) current.stamp = armLayoutHistory()
  finishSession(true)
}

export function resetLayoutBaseline(): void {
  sizeEpoch += 1
}

export function layoutRestoreEpoch(): number {
  return restoreEpoch
}

export function noteNodeSize(id: string, width: number, height: number, resizing: boolean): void {
  if (sizeSeen.get(id) !== sizeEpoch) {
    sizeSeen.set(id, sizeEpoch)
    sizes.set(id, { width, height })
    return
  }
  const previous = sizes.get(id)
  sizes.set(id, { width, height })
  if (!previous) return
  if (Math.abs(previous.height - height) < 1 && Math.abs(previous.width - width) < 1) return
  if (resizing) {
    liveLayout(id)
    return
  }
  engageLayout(id, true)
}

export function notedSize(id: string): { width: number; height: number } | null {
  return sizes.get(id) ?? null
}

export function rememberNodeSize(id: string, width: number, height: number): void {
  sizeSeen.set(id, sizeEpoch)
  sizes.set(id, { width, height })
}

export function installLayout(next: LayoutHost): () => void {
  host = next
  const removeBridge = registerLayoutBridge({
    beforeWrite: (id) => {
      if (session?.live && session.changedId === id) {
        session.deferred = true
        session.unsaved = true
        return 'defer'
      }
      if (session?.live) {
        finishSession(false)
        return 'done'
      }
      finishLayoutNow()
      return 'done'
    },
    afterWrite: () => {
      if (!session?.deferred || !host) return
      cancelFrame()
      session.live = false
      session.unsaved = true
      session.stamp = armLayoutHistory()
      const targets = targetsFrom(session.changedId, true) ?? session.targets
      if (targets.size === 0) {
        const changedId = session.changedId
        session = null
        applied = null
        generation += 1
        host.commit([], changedId)
        return
      }
      session.from = shownPositions()
      session.targets = targets
      session.started = performance.now()
      if (reducedMotion()) play(session.started + MAX_MS)
      else frame = requestAnimationFrame(play)
    },
    prepareHistory: () => {
      finishLayoutNow()
    },
    markRestore: () => {
      restoreEpoch += 1
      sizeEpoch += 1
    },
  })
  window.__branchlogLayout = {
    finish: () => finishLayoutNow(),
    idle: () => layoutIdle(),
    generation: () => layoutGeneration(),
  }
  return () => {
    cancelFrame()
    session = null
    host = null
    removeBridge()
    delete window.__branchlogLayout
  }
}

declare global {
  interface Window {
    __branchlogLayout?: {
      finish: () => void
      idle: () => boolean
      generation: () => number
    }
  }
}
