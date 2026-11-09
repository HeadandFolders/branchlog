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

function closest(body: SeparateBody, parent: SeparateBody, bodies: SeparateBody[]): SeparateMove {
  const minX = Math.ceil(parent.x + parent.width + SEPARATE_GAP)
  const targetY = Math.round(parent.y)
  const obstacles = bodies.filter((other) => other.id !== body.id)
  const xs = new Set([minX, Math.round(body.x)])
  for (const other of obstacles) {
    xs.add(Math.floor(other.x - body.width - SEPARATE_GAP))
    xs.add(Math.ceil(other.x + other.width + SEPARATE_GAP))
  }
  let best = { id: body.id, x: body.x, y: body.y }
  let score = (body.x - minX) ** 2 + (body.y - targetY) ** 2
  for (const x of [...xs].filter((value) => value >= minX).sort((a, b) => a - b)) {
    const dx = (x - minX) ** 2
    if (dx >= score - 0.01) break
    const y = nearestY(body, obstacles, x, targetY)
    const distance = dx + (y - targetY) ** 2
    if (distance >= score - 0.01) continue
    best = { id: body.id, x, y }
    score = distance
  }
  return best
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
  const depths = new Map<string, number>()
  const depth = (body: SeparateBody): number => {
    const saved = depths.get(body.id)
    if (saved !== undefined) return saved
    const parent = body.parentId ? byId.get(body.parentId) : undefined
    const value = parent ? depth(parent) + 1 : 0
    depths.set(body.id, value)
    return value
  }
  const movable = placed
    .filter((body) => !body.fixed && !body.pinned && body.parentId && body.id !== changed.parentId && nearby(region, originals.get(body.id)!))
    .sort((a, b) => depth(a) - depth(b) || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
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
