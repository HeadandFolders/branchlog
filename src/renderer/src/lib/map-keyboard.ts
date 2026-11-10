import type { MapGraph, MapGraphNode } from '@shared/map-graph'
import type { MapPoint } from '@shared/map-layout'

function nearestY(candidates: MapGraphNode[], points: ReadonlyMap<string, MapPoint>, from: MapPoint): string | null {
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const point = points.get(candidate.id)
    if (!point) continue
    const distance = Math.abs(point.y - from.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate.id
    }
  }
  return best
}

export function mapNodeTarget(
  graph: MapGraph,
  points: ReadonlyMap<string, MapPoint>,
  id: string,
  key: string,
): string | null {
  const node = graph.nodes.find((item) => item.id === id)
  const point = points.get(id)
  if (!node || !point) return null
  const byId = new Map(graph.nodes.map((item) => [item.id, item]))

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const incoming = key === 'ArrowLeft'
    const links = graph.links.filter((link) => (incoming ? link.target === id : link.source === id))
    const preferred = links.filter((link) => link.kind === 'branch')
    const pool = preferred.length > 0 ? preferred : links
    const candidates = pool
      .map((link) => byId.get(incoming ? link.source : link.target))
      .filter((item): item is MapGraphNode => item !== undefined)
    return nearestY(candidates, points, point)
  }

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const above = key === 'ArrowUp'
    const candidates = graph.nodes.filter((item) => {
      if (item.id === id || item.date !== node.date) return false
      const other = points.get(item.id)
      return other !== undefined && (above ? other.y < point.y : other.y > point.y)
    })
    return nearestY(candidates, points, point)
  }

  return null
}

export function focusMapNode(id: string): boolean {
  const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
  if (!element) return false
  element.focus()
  return true
}