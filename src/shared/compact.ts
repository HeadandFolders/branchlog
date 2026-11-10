import { NEIGHBOR_RADIUS, SEPARATE_GAP, separateNearby, type SeparateBody, type SeparateMove } from './separate'

export interface NodeSize {
  width: number
  height: number
}

function nearby(a: SeparateBody, b: SeparateBody): boolean {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width))
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  return dx <= NEIGHBOR_RADIUS && dy <= NEIGHBOR_RADIUS
}

function nearestY(body: SeparateBody, obstacles: SeparateBody[], x: number, target: number): number {
  const intervals = obstacles
    .filter((other) => x + body.width + SEPARATE_GAP > other.x && other.x + other.width + SEPARATE_GAP > x)
    .map((other) => ({
      low: Math.floor(other.y - body.height - SEPARATE_GAP),
      high: Math.ceil(other.y + other.height + SEPARATE_GAP),
    }))
    .sort((a, b) => a.low - b.low || a.high - b.high)
  const merged: { low: number; high: number }[] = []
  for (const interval of intervals) {
    const last = merged.at(-1)
    if (last && interval.low < last.high) last.high = Math.max(last.high, interval.high)
    else merged.push({ ...interval })
  }
  const blocked = merged.find((interval) => target > interval.low && target < interval.high)
  if (!blocked) return target
  const above = target - blocked.low
  const below = blocked.high - target
  if (above === below) return body.y < target ? blocked.low : blocked.high
  return above < below ? blocked.low : blocked.high
}

interface Spot {
  x: number
  y: number
}

// The clear point nearest a parent: hug its right edge, then give up rows
// before giving up a column. Without a start point the search ignores where
// the body already stands, so a node born in a collision still gets the spot
// closest to its parent rather than the closest spot to where it was born.
function nearestSlot(
  body: SeparateBody,
  parent: SeparateBody,
  bodies: readonly SeparateBody[],
  start: Spot | null,
): SeparateMove {
  const minX = Math.ceil(parent.x + parent.width + SEPARATE_GAP)
  const targetY = Math.round(parent.y)
  const obstacles = bodies.filter((other) => other.id !== body.id)
  const xs = new Set([minX])
  if (start) xs.add(Math.round(start.x))
  for (const other of obstacles) {
    xs.add(Math.floor(other.x - body.width - SEPARATE_GAP))
    xs.add(Math.ceil(other.x + other.width + SEPARATE_GAP))
  }
  const at = (x: number): SeparateMove => ({ id: body.id, x, y: nearestY(body, obstacles, x, targetY) })
  const score = (spot: SeparateMove): number => (spot.x - minX) ** 2 + (spot.y - targetY) ** 2
  let best = start ? { id: body.id, x: start.x, y: start.y } : at(minX)
  let from = score(best)
  for (const x of [...xs].filter((value) => value >= minX).sort((a, b) => a - b)) {
    const dx = (x - minX) ** 2
    if (dx >= from - 0.01) break
    const spot = at(x)
    const distance = score(spot)
    if (distance >= from - 0.01) continue
    best = spot
    from = distance
  }
  return best
}

function closest(body: SeparateBody, parent: SeparateBody, bodies: SeparateBody[]): SeparateMove {
  return nearestSlot(body, parent, bodies, body)
}

function depthByParent(byId: Map<string, SeparateBody>): (body: SeparateBody) => number {
  const depths = new Map<string, number>()
  const depth = (body: SeparateBody): number => {
    const saved = depths.get(body.id)
    if (saved !== undefined) return saved
    const parent = body.parentId ? byId.get(body.parentId) : undefined
    const value = parent ? depth(parent) + 1 : 0
    depths.set(body.id, value)
    return value
  }
  return depth
}

// Parents before children, so a subtree collapses as one block instead of a
// child chasing a parent that has not moved yet.
function byDepthThenPlace(depth: (body: SeparateBody) => number): (a: SeparateBody, b: SeparateBody) => number {
  return (a, b) => depth(a) - depth(b) || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)
}

const TIDY_PASSES = 3

// Every branch back to the clear spot nearest its parent, whatever distance it
// is parked at now. This is the only place the search ignores where a body
// already stands, so it is reached only by an explicit tidy, never by a create,
// a drag or a resize. One pass already leaves every placed spot clear of the
// bodies that settled before it and of the old footprints of those after it;
// the extra passes only tighten what that ordering forced a body to dodge.
export function tidyToParents(bodies: readonly SeparateBody[]): SeparateMove[] {
  const placed = bodies.map((body) => ({ ...body }))
  const byId = new Map(placed.map((body) => [body.id, body]))
  const movable = placed
    .filter((body) => !body.fixed && !body.pinned && body.parentId && byId.has(body.parentId))
    .sort(byDepthThenPlace(depthByParent(byId)))
  for (let pass = 0; pass < TIDY_PASSES; pass += 1) {
    let moved = false
    for (const body of movable) {
      const next = nearestSlot(body, byId.get(body.parentId!)!, placed, null)
      if (next.x === body.x && next.y === body.y) continue
      Object.assign(body, next)
      moved = true
    }
    if (!moved) break
  }
  const originals = new Map(bodies.map((body) => [body.id, body]))
  return placed
    .filter((body) => {
      const original = originals.get(body.id)!
      return body.x !== original.x || body.y !== original.y
    })
    .map((body) => ({ id: body.id, x: body.x, y: body.y }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function placeBesideParent(
  bodies: readonly SeparateBody[],
  changedId: string,
): SeparateMove | null {
  const body = bodies.find((item) => item.id === changedId)
  if (!body?.parentId) return null
  const parent = bodies.find((item) => item.id === body.parentId)
  if (!parent) return null
  return nearestSlot(body, parent, bodies, null)
}

export function compactNearby(
  bodies: readonly SeparateBody[],
  changedId: string,
  previousSize: NodeSize,
): SeparateMove[] {
  const changed = bodies.find((body) => body.id === changedId)
  if (!changed?.parentId) return separateNearby(bodies, changedId)
  const originals = new Map(bodies.map((body) => [body.id, body]))
  const placed = bodies.map((body) => ({ ...body, pinned: body.id === changedId || body.pinned }))
  const byId = new Map(placed.map((body) => [body.id, body]))
  for (const move of separateNearby(placed, changedId)) Object.assign(byId.get(move.id)!, move)
  const region = { ...changed, ...previousSize }
  const movable = placed
    .filter((body) => !body.fixed && !body.pinned && body.parentId && body.id !== changed.parentId && nearby(region, originals.get(body.id)!))
    .sort(byDepthThenPlace(depthByParent(byId)))
  for (let pass = 0; pass <= movable.length; pass += 1) {
    let moved = false
    for (const body of movable) {
      const parent = body.parentId ? byId.get(body.parentId) : undefined
      if (!parent) continue
      const next = closest(body, parent, placed)
      if (next.x === body.x && next.y === body.y) continue
      Object.assign(body, next)
      moved = true
    }
    if (!moved) break
  }
  return placed
    .filter((body) => {
      const original = originals.get(body.id)!
      return body.x !== original.x || body.y !== original.y
    })
    .map((body) => ({ id: body.id, x: body.x, y: body.y }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
