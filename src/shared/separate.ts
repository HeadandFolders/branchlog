export const SEPARATE_GAP = 16
export const NEIGHBOR_RADIUS = 720
const PARENT_SLACK = 480
const MAX_PASSES = 64

export interface SeparateBody {
  id: string
  x: number
  y: number
  width: number
  height: number
  fixed: boolean
  pinned: boolean
  parentId: string | null
}

export interface SeparateMove {
  id: string
  x: number
  y: number
}

interface Item {
  id: string
  x: number
  y: number
  width: number
  height: number
  fixed: boolean
  pinned: boolean
  parentId: string | null
  pushed: boolean
  originX: number
  originY: number
  columnId: string | null
  columnWay: number
}

interface Penetration {
  x: number
  y: number
  cx: number
  cy: number
}

function cloneItem(body: SeparateBody): Item {
  return {
    id: body.id,
    x: body.x,
    y: body.y,
    width: body.width,
    height: body.height,
    fixed: body.fixed,
    pinned: body.pinned,
    parentId: body.parentId,
    pushed: false,
    originX: body.x,
    originY: body.y,
    columnId: null,
    columnWay: 0,
  }
}

function rank(item: Item, changedId: string): number {
  if (item.fixed || item.pinned) return 100
  if (item.id === changedId) return 0
  if (item.pushed) return 1
  return 2
}

function penetration(a: Item, b: Item): Penetration | null {
  const acx = a.x + a.width / 2
  const bcx = b.x + b.width / 2
  const acy = a.y + a.height / 2
  const bcy = b.y + b.height / 2
  const overlapX = (a.width + b.width) / 2 + SEPARATE_GAP - Math.abs(acx - bcx)
  const overlapY = (a.height + b.height) / 2 + SEPARATE_GAP - Math.abs(acy - bcy)
  if (overlapX <= 0.01 || overlapY <= 0.01) return null
  return { x: overlapX, y: overlapY, cx: acx - bcx, cy: acy - bcy }
}

function parentEdge(item: Item, byId: Map<string, Item>): number | null {
  if (!item.parentId) return null
  const parent = byId.get(item.parentId)
  if (!parent) return null
  return parent.x + parent.width
}

function moveItem(item: Item, dx: number, dy: number, edge: number | null): boolean {
  if (item.fixed || item.pinned) return false
  if (dx === 0 && dy === 0) return false
  const nextX = item.x + dx
  if (edge !== null && nextX < edge + SEPARATE_GAP) {
    if (dy === 0) return false
    item.y += dy
    item.pushed = true
    return true
  }
  item.x = nextX
  item.y += dy
  item.pushed = true
  return true
}

function direction(delta: number): number {
  if (delta > 0.01) return 1
  if (delta < -0.01) return -1
  return 1
}

// Fixed bodies are the main list rows: one continuous column a node can walk
// forever. A second shove away from a different row, the same way, means the
// node is walking the column instead of leaving it.
function walksTheColumn(mover: Item, column: Item, way: number): boolean {
  if (mover.columnId === null || mover.columnId === column.id) return false
  return mover.columnWay === way
}

function stepOutOfColumn(mover: Item, column: Item, edge: number | null): boolean {
  const min = edge === null ? Number.NEGATIVE_INFINITY : edge + SEPARATE_GAP
  const right = column.x + column.width + SEPARATE_GAP
  const left = column.x - mover.width - SEPARATE_GAP
  const first = mover.x + mover.width / 2 < column.x + column.width / 2 ? left : right
  const second = first === left ? right : left
  for (const target of [first, second]) {
    if (target < min || target === mover.x) continue
    mover.x = target
    mover.pushed = true
    return true
  }
  return false
}

function shove(
  mover: Item,
  amount: number,
  axis: 'x' | 'y',
  delta: number,
  byId: Map<string, Item>,
  partner: Item,
): boolean {
  const way = direction(delta)
  const edge = parentEdge(mover, byId)
  if (axis === 'y' && partner.fixed && walksTheColumn(mover, partner, way) && stepOutOfColumn(mover, partner, edge)) {
    return true
  }
  const dx = axis === 'x' ? way * amount : 0
  const dy = axis === 'y' ? way * amount : 0
  const moved = moveItem(mover, dx, dy, edge)
  if (moved && axis === 'y' && partner.fixed) {
    mover.columnId = partner.id
    mover.columnWay = way
  }
  return moved
}

function resolvePair(a: Item, b: Item, changedId: string, byId: Map<string, Item>): number {
  const hit = penetration(a, b)
  if (!hit) return 0
  const rankA = rank(a, changedId)
  const rankB = rank(b, changedId)
  if (rankA >= 100 && rankB >= 100) return 0
  if (rankA === 2 && rankB === 2) return 0
  const preferX = hit.x < hit.y - 0.01
  const axis: 'x' | 'y' = preferX ? 'x' : 'y'
  const other: 'x' | 'y' = axis === 'x' ? 'y' : 'x'
  const primary = axis === 'x' ? hit.x : hit.y
  const secondary = other === 'x' ? hit.x : hit.y
  const delta = axis === 'x' ? hit.cx : hit.cy
  const otherDelta = other === 'x' ? hit.cx : hit.cy
  const before = a.x + a.y + b.x + b.y
  if (rankA < rankB) {
    if (!shove(a, primary, axis, delta, byId, b)) shove(a, secondary, other, otherDelta, byId, b)
  } else if (rankB < rankA) {
    if (!shove(b, primary, axis, -delta, byId, a)) shove(b, secondary, other, -otherDelta, byId, a)
  } else if (a.id > b.id) {
    if (!shove(a, primary, axis, delta, byId, b)) shove(b, primary, axis, -delta, byId, a)
  } else if (!shove(b, primary, axis, -delta, byId, a)) {
    shove(a, primary, axis, delta, byId, b)
  }
  return Math.abs(a.x + a.y + b.x + b.y - before)
}

function anyHit(items: Item[], changedId: string): boolean {
  for (let i = 0; i < items.length; i += 1) {
    const left = items[i]
    if (!left) continue
    for (let j = i + 1; j < items.length; j += 1) {
      const right = items[j]
      if (!right || !penetration(left, right)) continue
      const rankA = rank(left, changedId)
      const rankB = rank(right, changedId)
      if (rankA >= 100 && rankB >= 100) continue
      if (rankA === 2 && rankB === 2) continue
      return true
    }
  }
  return false
}

function pullChanged(changed: Item | undefined, byId: Map<string, Item>): void {
  if (!changed || changed.pinned || changed.fixed) return
  const edge = parentEdge(changed, byId)
  if (edge === null) return
  const minX = edge + SEPARATE_GAP
  const maxX = edge + PARENT_SLACK
  if (changed.x < minX) changed.x = minX
  else if (changed.x > maxX) changed.x = maxX
}

function segmentHits(item: Item, x1: number, y1: number, x2: number, y2: number): boolean {
  const left = item.x - 2
  const right = item.x + item.width + 2
  const top = item.y - 2
  const bottom = item.y + item.height + 2
  const steps = 8
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps
    const x = x1 + (x2 - x1) * t
    const y = y1 + (y2 - y1) * t
    if (x >= left && x <= right && y >= top && y <= bottom) return true
  }
  return false
}

function nudgeOffArrows(items: Item[], changedId: string, byId: Map<string, Item>): void {
  for (const item of items) {
    if (item.fixed || item.pinned) continue
    if (item.id !== changedId && !item.pushed) continue
    for (const other of items) {
      if (other.id === item.id || !other.parentId) continue
      const parent = byId.get(other.parentId)
      if (!parent) continue
      const x1 = parent.x + parent.width
      const y1 = parent.y + parent.height / 2
      const x2 = other.x
      const y2 = other.y + other.height / 2
      if (!segmentHits(item, x1, y1, x2, y2)) continue
      const above = item.y + item.height / 2 < y1
      const dy = above ? -8 : 8
      if (moveItem(item, 0, dy, parentEdge(item, byId))) break
    }
  }
}

function solve(items: Item[], changedId: string): void {
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const byId = new Map(items.map((item) => [item.id, item]))
  if (!anyHit(items, changedId)) return
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let moved = 0
    for (let i = 0; i < items.length; i += 1) {
      const left = items[i]
      if (!left) continue
      for (let j = i + 1; j < items.length; j += 1) {
        const right = items[j]
        if (!right) continue
        moved += resolvePair(left, right, changedId, byId)
      }
    }
    if (pass % 4 === 3) {
      pullChanged(byId.get(changedId), byId)
      nudgeOffArrows(items, changedId, byId)
    }
    if (moved < 0.05) break
  }
  pullChanged(byId.get(changedId), byId)
  for (const item of items) {
    item.x = Math.round(item.x)
    item.y = Math.round(item.y)
  }
  for (let pass = 0; pass < 8; pass += 1) {
    if (!anyHit(items, changedId)) break
    for (let i = 0; i < items.length; i += 1) {
      const left = items[i]
      if (!left) continue
      for (let j = i + 1; j < items.length; j += 1) {
        const right = items[j]
        if (!right) continue
        resolvePair(left, right, changedId, byId)
      }
    }
  }
}

function toMoves(items: Item[]): SeparateMove[] {
  const moves: SeparateMove[] = []
  for (const item of items) {
    if (item.fixed || item.pinned) continue
    if (Math.abs(item.x - item.originX) < 0.5 && Math.abs(item.y - item.originY) < 0.5) continue
    moves.push({ id: item.id, x: item.x, y: item.y })
  }
  return moves
}

export function separateBodies(bodies: readonly SeparateBody[], changedId: string): SeparateMove[] {
  if (!bodies.some((body) => body.id === changedId)) return []
  const items = bodies.map(cloneItem)
  if (!anyHit(items, changedId)) return []
  solve(items, changedId)
  if (anyHit(items, changedId)) solve(items, changedId)
  return toMoves(items)
}

function nearChanged(changed: SeparateBody, body: SeparateBody): boolean {
  const dx = Math.max(changed.x - (body.x + body.width), body.x - (changed.x + changed.width))
  const dy = Math.max(changed.y - (body.y + body.height), body.y - (changed.y + changed.height))
  return dx < NEIGHBOR_RADIUS && dy < NEIGHBOR_RADIUS
}

export function separateNearby(bodies: readonly SeparateBody[], changedId: string): SeparateMove[] {
  const changed = bodies.find((body) => body.id === changedId)
  if (!changed) return []
  const extra = new Set<string>()
  let latest: SeparateMove[] = []
  for (let expand = 0; expand < 6; expand += 1) {
    const chosen = bodies.filter((body) => {
      if (body.id === changedId || extra.has(body.id)) return true
      if (body.id === changed.parentId || body.parentId === changed.id) return true
      return nearChanged(changed, body)
    })
    const items = chosen.map(cloneItem)
    if (!anyHit(items, changedId)) return latest
    solve(items, changedId)
    latest = toMoves(items)
    const placed = new Map(items.map((item) => [item.id, item]))
    let grew = false
    for (const body of bodies) {
      if (placed.has(body.id)) continue
      const probe = cloneItem(body)
      for (const item of items) {
        if (!penetration(probe, item)) continue
        const moved =
          item.id === changedId ||
          Math.abs(item.x - item.originX) >= 0.5 ||
          Math.abs(item.y - item.originY) >= 0.5
        if (!moved) continue
        extra.add(body.id)
        grew = true
        break
      }
    }
    if (!grew) return latest
  }
  return latest
}

export interface MarginSlot {
  id: string
  x: number
  y: number
  height: number
  // Order within the task line this comment belongs to: 0 for the one that should
  // sit on the line, 1 for the next. Comments born on one line share a y, so this
  // breaks that tie by age instead of by id.
  hold: number
}

// The left margin is one column: every comment sits at the same x, so the pairwise
// shove above would push the later one sideways out of it. Walking down in order and
// only lifting a floor keeps the column intact, holds a comment on its own task line
// whenever there is room, and moves a box only when it truly overlaps the one above.
// Nothing moves up, so a comment never jumps over the text the reader is on.
export function settleMargin(slots: readonly MarginSlot[], gap: number): SeparateMove[] {
  const ordered = [...slots].sort((a, b) => a.y - b.y || a.hold - b.hold || (a.id < b.id ? -1 : 1))
  const moves: SeparateMove[] = []
  let floor = Number.NEGATIVE_INFINITY
  for (const slot of ordered) {
    const y = slot.y < floor ? Math.round(floor) : slot.y
    floor = y + slot.height + gap
    if (Math.abs(y - slot.y) > 0.5) moves.push({ id: slot.id, x: slot.x, y })
  }
  return moves
}
