import { create } from 'zustand'
import type { Viewport } from '@xyflow/react'
import { buildMapGraph, type MapGraph, type MapGraphNode } from '@shared/map-graph'
import {
  expansionPoints,
  layoutMapGraph,
  mapNodeSizes,
  placeNearParent,
  settleNewNodes,
  type MapPoint,
} from '@shared/map-layout'
import type { MapPosition, MapTask, TaskChainState } from '@shared/types'
import { pushMapHistory } from './history'
import { usePreferences } from './preferences'

export interface ChainInfo {
  count: number
  latestId: string
}

interface MapState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  tasks: MapTask[]
  states: TaskChainState[]
  graph: MapGraph | null
  nodesById: ReadonlyMap<string, MapGraphNode>
  chains: ReadonlyMap<string, ChainInfo>
  points: ReadonlyMap<string, MapPoint>
  expanded: ReadonlySet<string>
  viewport: Viewport | null
  legendOpen: boolean
  load: () => Promise<void>
  syncGraph: () => void
  toggleExpanded: (chainId: string) => void
  toggleLegend: () => void
  moveNode: (nodeId: string, point: MapPoint) => void
  rearrange: () => void
  restorePoints: (points: readonly MapPosition[]) => void
  setViewport: (viewport: Viewport) => void
}

function resolvePoints(
  graph: MapGraph,
  previous: MapGraph | null,
  previousPoints: ReadonlyMap<string, MapPoint>,
): Map<string, MapPoint> {
  const sizes = mapNodeSizes(graph)
  const next = new Map<string, MapPoint>()
  const fresh: MapGraphNode[] = []
  const collapsed = (previous?.nodes ?? []).filter((node) => node.count > 1)
  const anchorIds = new Set(collapsed.map((node) => node.id))
  const anchorCopies = new Map(collapsed.map((node) => [node.chainId, node.taskId]))
  for (const node of graph.nodes) {
    // While a chain was collapsed its one point stood for the whole chain and sat in the latest
    // copy's column, so on expansion that point belongs to the latest copy only.
    const inherited =
      node.count > 1
        ? previousPoints.get(node.taskId) ?? previousPoints.get(node.id) ?? node.saved
        : anchorIds.has(node.chainId)
          ? node.id === anchorCopies.get(node.chainId)
            ? previousPoints.get(node.chainId) ?? node.saved
            : node.saved
          : previousPoints.get(node.id) ?? previousPoints.get(node.taskId) ?? node.saved
    if (inherited) next.set(node.id, inherited)
    else fresh.push(node)
  }
  if (fresh.length === 0) return next
  if (next.size === 0) return layoutMapGraph(graph, sizes)

  const previousById = new Map(previous?.nodes.map((node) => [node.id, node]) ?? [])
  const handledChains = new Set<string>()
  const moved: string[] = []
  for (const node of fresh) {
    if (next.has(node.id)) continue
    const chainNode = previousById.get(node.chainId)
    const chainPoint = previousPoints.get(node.chainId) ?? next.get(node.chainId)
    if (chainNode && chainPoint && !handledChains.has(node.chainId)) {
      handledChains.add(node.chainId)
      const copies = graph.nodes.filter((item) => item.chainId === node.chainId)
      const spread = expansionPoints(chainNode, copies, chainPoint, graph)
      for (const copy of copies) {
        if (next.has(copy.id)) continue
        const point = spread.get(copy.id)
        if (!point) continue
        next.set(copy.id, point)
        moved.push(copy.id)
      }
      continue
    }
    next.set(node.id, placeNearParent(node, graph, next, sizes))
    moved.push(node.id)
  }
  return settleNewNodes(next, graph, sizes, moved)
}

function chainInfo(tasks: readonly MapTask[]): Map<string, ChainInfo> {
  const chains = new Map<string, ChainInfo>()
  const latestDate = new Map<string, string>()
  for (const task of tasks) {
    const info = chains.get(task.chainId)
    if (!info) {
      chains.set(task.chainId, { count: 1, latestId: task.id })
      latestDate.set(task.chainId, task.dateCreated)
      continue
    }
    info.count += 1
    if (task.dateCreated >= (latestDate.get(task.chainId) ?? '')) {
      info.latestId = task.id
      latestDate.set(task.chainId, task.dateCreated)
    }
  }
  return chains
}

async function writePoints(points: readonly MapPosition[]): Promise<void> {
  if (points.length === 0) return
  try {
    const wrote = await window.branchlog.map.savePositions([...points])
    if (!wrote.ok) useMap.setState({ error: 'Could not save that position.' })
  } catch (error) {
    console.error(error)
    useMap.setState({ error: 'Could not save that position.' })
  }
}

function applyPoints(tasks: readonly MapTask[], points: readonly MapPosition[]): MapTask[] {
  const byId = new Map(points.map((point) => [point.taskId, point]))
  return tasks.map((task) => {
    const point = byId.get(task.id)
    return point ? { ...task, mapX: point.x, mapY: point.y } : task
  })
}

export const useMap = create<MapState>((set, get) => ({
  status: 'idle',
  error: null,
  tasks: [],
  states: [],
  graph: null,
  nodesById: new Map(),
  chains: new Map(),
  points: new Map(),
  expanded: new Set(),
  viewport: null,
  legendOpen: true,

  load: async () => {
    set({ status: 'loading', error: null })
    try {
      const data = await window.branchlog.map.load()
      set({ tasks: data.tasks, states: data.states, status: 'ready' })
      get().syncGraph()
    } catch (error) {
      console.error(error)
      set({ status: 'error', error: error instanceof Error ? error.message : 'Could not load the concept map.' })
    }
  },

  syncGraph: () => {
    const state = get()
    if (state.status !== 'ready') return
    const graph = buildMapGraph(state.tasks, state.states, {
      expandAll: usePreferences.getState().mapExpandChains,
      expanded: state.expanded,
    })
    set({
      graph,
      nodesById: new Map(graph.nodes.map((node) => [node.id, node])),
      chains: chainInfo(state.tasks),
      points: resolvePoints(graph, state.graph, state.points),
    })
  },

  toggleExpanded: (chainId) => {
    const expanded = new Set(get().expanded)
    if (expanded.has(chainId)) expanded.delete(chainId)
    else expanded.add(chainId)
    set({ expanded })
    get().syncGraph()
  },

  toggleLegend: () => set((state) => ({ legendOpen: !state.legendOpen })),

  moveNode: (nodeId, point) => {
    const state = get()
    const node = state.nodesById.get(nodeId)
    const previous = state.points.get(nodeId)
    if (!node || !previous || (previous.x === point.x && previous.y === point.y)) return
    const before: MapPosition[] = [{ taskId: node.taskId, x: previous.x, y: previous.y }]
    const after: MapPosition[] = [{ taskId: node.taskId, x: point.x, y: point.y }]
    const points = new Map(state.points)
    points.set(nodeId, point)
    set({ points, tasks: applyPoints(state.tasks, after) })
    pushMapHistory(before, after)
    void writePoints(after)
  },

  rearrange: () => {
    const state = get()
    if (!state.graph || state.graph.nodes.length === 0) return
    const layout = layoutMapGraph(state.graph, mapNodeSizes(state.graph))
    const before: MapPosition[] = []
    const after: MapPosition[] = []
    const points = new Map(state.points)
    for (const node of state.graph.nodes) {
      const point = layout.get(node.id)
      if (!point) continue
      const previous = state.points.get(node.id)
      if (previous) before.push({ taskId: node.taskId, x: previous.x, y: previous.y })
      after.push({ taskId: node.taskId, x: point.x, y: point.y })
      points.set(node.id, point)
    }
    set({ points, tasks: applyPoints(state.tasks, after) })
    pushMapHistory(before, after)
    void writePoints(after)
  },

  restorePoints: (points) => {
    const state = get()
    if (!state.graph || points.length === 0) return
    const next = new Map(state.points)
    for (const point of points) {
      const nodeId = state.graph.nodeIdByTaskId.get(point.taskId)
      if (nodeId) next.set(nodeId, { x: point.x, y: point.y })
    }
    set({ points: next, tasks: applyPoints(state.tasks, points) })
    void writePoints(points)
  },

  setViewport: (viewport) => set({ viewport }),
}))