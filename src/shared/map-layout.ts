import dagre from '@dagrejs/dagre'
import { dateColumns, type MapGraph, type MapGraphNode } from './map-graph'
import { separateNearby, type SeparateBody } from './separate'

export interface MapSize {
  width: number
  height: number
}

export interface MapPoint {
  x: number
  y: number
}

export const MAP_NODE_WIDTH = 220
export const MAP_COLUMN_PITCH = 280
export const MAP_ROW_GAP = 28
export const MAP_LEFT = 60
export const MAP_TOP = 96

const CHARS_PER_LINE = 26
const LINE_HEIGHT = 19
const PAD_Y = 10
const META_ROW = 20

function lineUnits(part: string): number {
  let units = 0
  for (const char of part) units += char.charCodeAt(0) > 0x2e7f ? 2 : 1
  return units
}

export function estimateMapNodeHeight(node: MapGraphNode): number {
  const lines = node.text
    .split('\n')
    .reduce((total, part) => total + Math.max(1, Math.ceil(lineUnits(part) / CHARS_PER_LINE)), 0)
  return PAD_Y * 2 + lines * LINE_HEIGHT + META_ROW
}

export function mapNodeSize(node: MapGraphNode, measured?: ReadonlyMap<string, MapSize>): MapSize {
  return measured?.get(node.id) ?? { width: MAP_NODE_WIDTH, height: estimateMapNodeHeight(node) }
}

export function mapNodeSizes(graph: MapGraph, measured?: ReadonlyMap<string, MapSize>): Map<string, MapSize> {
  return new Map(graph.nodes.map((node) => [node.id, mapNodeSize(node, measured)]))
}

export function columnX(date: string, columns: readonly string[]): number {
  return MAP_LEFT + Math.max(0, columns.indexOf(date)) * MAP_COLUMN_PITCH
}

export function layoutMapGraph(graph: MapGraph, sizes: ReadonlyMap<string, MapSize>): Map<string, MapPoint> {
  const columns = dateColumns(graph.nodes)
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: MAP_ROW_GAP, ranksep: MAP_COLUMN_PITCH })
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  for (const node of graph.nodes) {
    const size = mapNodeSize(node, sizes)
    dagreGraph.setNode(node.id, { width: size.width, height: size.height })
  }
  for (const link of graph.links) dagreGraph.setEdge(link.source, link.target)
  dagre.layout(dagreGraph)

  const points = new Map<string, MapPoint>()
  for (const date of columns) {
    const column = graph.nodes.filter((node) => node.date === date)
    column.sort((a, b) => (dagreGraph.node(a.id).y ?? 0) - (dagreGraph.node(b.id).y ?? 0) || (a.id < b.id ? -1 : 1))
    let y = MAP_TOP
    for (const node of column) {
      points.set(node.id, { x: columnX(date, columns), y })
      y += mapNodeSize(node, sizes).height + MAP_ROW_GAP
    }
  }
  return points
}

export function placeNearParent(
  node: MapGraphNode,
  graph: MapGraph,
  placed: ReadonlyMap<string, MapPoint>,
  sizes: ReadonlyMap<string, MapSize>,
): MapPoint {
  const link =
    graph.links.find((item) => item.target === node.id && item.kind === 'branch') ??
    graph.links.find((item) => item.target === node.id)
  const parentPoint = link ? placed.get(link.source) : undefined
  if (link && parentPoint) {
    const parentHeight = sizes.get(link.source)?.height ?? 60
    return { x: parentPoint.x + 48, y: parentPoint.y + parentHeight + MAP_ROW_GAP }
  }
  const columns = dateColumns(graph.nodes)
  const x = columnX(node.date, columns)
  let y = MAP_TOP
  for (const other of graph.nodes) {
    const point = placed.get(other.id)
    if (!point || point.x !== x) continue
    y = Math.max(y, point.y + mapNodeSize(other, sizes).height + MAP_ROW_GAP)
  }
  return { x, y }
}

export function expansionPoints(
  chain: MapGraphNode,
  copies: readonly MapGraphNode[],
  chainPoint: MapPoint,
  graph: MapGraph,
): Map<string, MapPoint> {
  const columns = dateColumns(graph.nodes)
  const points = new Map<string, MapPoint>()
  for (const copy of copies) {
    points.set(
      copy.id,
      copy.id === chain.taskId ? { ...chainPoint } : { x: columnX(copy.date, columns), y: chainPoint.y },
    )
  }
  return points
}

export function settleNewNodes(
  base: ReadonlyMap<string, MapPoint>,
  graph: MapGraph,
  sizes: ReadonlyMap<string, MapSize>,
  newIds: readonly string[],
): Map<string, MapPoint> {
  const next = new Map(base)
  for (const id of newIds) {
    if (!next.has(id)) continue
    const bodies: SeparateBody[] = []
    for (const node of graph.nodes) {
      const point = next.get(node.id)
      if (!point) continue
      const size = mapNodeSize(node, sizes)
      bodies.push({
        id: node.id,
        x: point.x,
        y: point.y,
        width: size.width,
        height: size.height,
        fixed: false,
        pinned: node.id !== id,
        parentId: null,
      })
    }
    for (const move of separateNearby(bodies, id)) next.set(move.id, { x: move.x, y: move.y })
  }
  return next
}