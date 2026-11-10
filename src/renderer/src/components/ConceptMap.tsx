import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  MarkerType,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { MapGraph } from '@shared/map-graph'
import { estimateMapNodeHeight, MAP_NODE_WIDTH, type MapPoint } from '@shared/map-layout'
import type { EarlierTask } from '@shared/types'
import { canvasNavigation, keepOwnScroll } from '../lib/canvas-navigation'
import { earlierSearchIsOpen } from '../lib/earlier-search'
import { focusMapNode, mapNodeTarget } from '../lib/map-keyboard'
import { registerMapSearch } from '../lib/map-search-bridge'
import { shortDate } from '../lib/state-label'
import { setMapRestorer } from '../store/history'
import { useMap } from '../store/map'
import { useNotebook } from '../store/notebook'
import { usePreferences } from '../store/preferences'
import { useView } from '../store/view'
import { MapDateLabels } from './MapDateLabels'
import { MapLegend } from './MapLegend'
import { MapNode } from './MapNode'
import { MapToolbar } from './MapToolbar'
import '../styles/concept-map.css'

const nodeTypes: NodeTypes = { mapTask: MapNode }

function buildNodes(graph: MapGraph, points: ReadonlyMap<string, MapPoint>): Node[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: 'mapTask',
    position: points.get(node.id) ?? { x: 0, y: 0 },
    data: {},
    width: MAP_NODE_WIDTH,
    height: estimateMapNodeHeight(node),
    style: { width: MAP_NODE_WIDTH },
    draggable: true,
    selectable: false,
    connectable: false,
    focusable: true,
    ariaLabel: `${node.text === '' ? 'Empty task' : node.text}. ${shortDate(node.date)}. Activate to open that day.`,
  }))
}

function buildEdges(graph: MapGraph): Edge[] {
  return graph.links.map((link) => {
    const carry = link.kind === 'carry'
    return {
      id: link.id,
      source: link.source,
      target: link.target,
      type: 'smoothstep',
      className: carry ? 'map-edge map-edge-carry' : 'map-edge map-edge-branch',
      markerEnd: carry
        ? { type: MarkerType.ArrowClosed, width: 8, height: 8, color: 'var(--carried)' }
        : { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--edge)' },
      style: {
        stroke: carry ? 'var(--carried)' : 'var(--edge)',
        strokeWidth: 1.25,
        strokeDasharray: carry ? '4 4' : undefined,
      },
      interactionWidth: 12,
      focusable: false,
    }
  })
}

function miniNodeColor(node: Node): string {
  const entry = useMap.getState().nodesById.get(node.id)
  if (!entry) return 'var(--line)'
  if (entry.state.state === 'done') return 'var(--text-faint)'
  if (entry.state.state === 'finished-later') return 'var(--finished-later)'
  if (entry.state.state === 'dropped') return 'var(--dropped)'
  return entry.state.carriedFromDay !== null ? 'var(--carried)' : 'var(--edge-hover)'
}

function MapFlow() {
  const status = useMap((state) => state.status)
  const error = useMap((state) => state.error)
  const graph = useMap((state) => state.graph)
  const points = useMap((state) => state.points)
  const swipeToPan = usePreferences((state) => state.swipeToPan)
  const highlightCarried = usePreferences((state) => state.highlightCarried)
  const expandAll = usePreferences((state) => state.mapExpandChains)
  const showDaily = useView((state) => state.showDaily)
  const goToDate = useNotebook((state) => state.goToDate)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const dragging = useRef<string | null>(null)
  const instanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const booted = useRef(false)

  useEffect(() => {
    void useMap.getState().load()
  }, [])

  useEffect(() => {
    return window.branchlog.carry.onApplied(() => {
      void useMap.getState().load()
    })
  }, [])

  useEffect(() => {
    setMapRestorer((points) => useMap.getState().restorePoints(points))
    return () => setMapRestorer(null)
  }, [])

  useEffect(() => {
    useMap.getState().syncGraph()
  }, [expandAll])

  useEffect(() => {
    return registerMapSearch({
      search: (query) => {
        const { tasks, states } = useMap.getState()
        const done = new Map(states.map((state) => [state.id, state.state === 'done' || state.state === 'finished-later']))
        const needle = query.trim().toLowerCase()
        const rows: EarlierTask[] = []
        for (let index = tasks.length - 1; index >= 0 && rows.length < 40; index -= 1) {
          const task = tasks[index]
          if (!task) continue
          if (needle !== '' && !task.text.toLowerCase().includes(needle)) continue
          rows.push({ id: task.id, text: task.text, dateCreated: task.dateCreated, done: done.get(task.id) ?? false })
        }
        return rows
      },
      choose: (taskId) => {
        const state = useMap.getState()
        const nodeId = state.graph?.nodeIdByTaskId.get(taskId)
        const node = nodeId ? state.nodesById.get(nodeId) : undefined
        const point = nodeId ? state.points.get(nodeId) : undefined
        const instance = instanceRef.current
        if (!nodeId || !node || !point || !instance) return
        const zoom = Math.min(1, Math.max(0.7, instance.getZoom()))
        void instance
          .setCenter(point.x + MAP_NODE_WIDTH / 2, point.y + estimateMapNodeHeight(node) / 2, { zoom, duration: 200 })
          .then(() => focusMapNode(nodeId))
      },
    })
  }, [])

  useLayoutEffect(() => {
    if (dragging.current) return
    setNodes(graph ? buildNodes(graph, points) : [])
    setEdges(graph ? buildEdges(graph) : [])
  }, [graph, points])

  useEffect(() => {
    const instance = instanceRef.current
    if (!instance || status !== 'ready' || nodes.length === 0 || booted.current) return
    booted.current = true
    const saved = useMap.getState().viewport
    if (saved) void instance.setViewport(saved, { duration: 0 })
    else void instance.fitView({ padding: 0.15, maxZoom: 1, duration: 0 })
  }, [status, nodes])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || earlierSearchIsOpen()) return
      if (event.target instanceof Element && event.target.closest('[data-theme-lab], .ai-settings')) return
      showDaily()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showDaily])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges<Node>(changes, current))
  }, [])

  const openNode = useCallback(
    (id: string) => {
      const node = useMap.getState().nodesById.get(id)
      if (!node) return
      const date = node.count > 1 ? node.lastDate : node.date
      showDaily()
      void goToDate(date).then(() => {
        useNotebook.getState().focusAt(node.taskId)
      })
    },
    [goToDate, showDaily],
  )

  const reveal = useCallback((id: string) => {
    if (focusMapNode(id)) return
    const state = useMap.getState()
    const node = state.nodesById.get(id)
    const point = state.points.get(id)
    const instance = instanceRef.current
    if (!node || !point || !instance) return
    void instance
      .setCenter(point.x + MAP_NODE_WIDTH / 2, point.y + estimateMapNodeHeight(node) / 2, {
        zoom: instance.getZoom(),
        duration: 150,
      })
      .then(() => focusMapNode(id))
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const nodeEl = target.closest<HTMLElement>('.react-flow__node-mapTask')
    const id = nodeEl?.dataset.id
    if (!nodeEl || !id) return
    if (event.key === 'Enter') {
      if (target.closest('button')) return
      event.preventDefault()
      openNode(id)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const state = useMap.getState()
    if (!state.graph) return
    const next = mapNodeTarget(state.graph, state.points, id, event.key)
    if (!next) return
    event.preventDefault()
    reveal(next)
  }

  const fit = useCallback(() => {
    void instanceRef.current?.fitView({ padding: 0.15, maxZoom: 1, duration: 200 })
  }, [])

  const empty = status === 'ready' && graph !== null && graph.nodes.length === 0

  return (
    <div
      className="map-canvas relative h-full w-full"
      data-swipe-pan={swipeToPan ? '1' : '0'}
      data-carried-highlight={highlightCarried ? '1' : '0'}
      onWheelCapture={keepOwnScroll}
      onKeyDown={onKeyDown}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => openNode(node.id)}
        onNodeDragStart={(_event, node) => {
          dragging.current = node.id
        }}
        onNodeDragStop={(_event, node) => {
          dragging.current = null
          useMap.getState().moveNode(node.id, { x: node.position.x, y: node.position.y })
        }}
        onInit={(instance) => {
          instanceRef.current = instance
        }}
        onMoveEnd={(_event, viewport) => useMap.getState().setViewport(viewport)}
        minZoom={0.2}
        maxZoom={2}
        {...canvasNavigation(swipeToPan)}
        zoomOnDoubleClick={false}
        panOnDrag
        selectionOnDrag={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onlyRenderVisibleElements
        deleteKeyCode={null}
        style={{ background: 'var(--bg)' }}
      >
        <Background gap={24} size={1} color="color-mix(in srgb, var(--line) 40%, transparent)" />
        <MapDateLabels />
        <Controls className="map-controls" position="bottom-left" showInteractive={false} showFitView={false} />
        <MiniMap
          className="map-minimap"
          position="bottom-right"
          pannable
          zoomable
          nodeColor={miniNodeColor}
          nodeStrokeWidth={0}
          nodeBorderRadius={8}
          maskColor="var(--bg-subtle)"
        />
      </ReactFlow>
      <MapToolbar onFit={fit} />
      <MapLegend />
      {status === 'loading' || status === 'idle' ? (
        <div className="map-note" role="status">
          Opening the map…
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="map-note" role="status">
          <p>{error ?? 'Could not load the concept map.'}</p>
          <button type="button" className="map-note-action" onClick={() => void useMap.getState().load()}>
            Try again
          </button>
        </div>
      ) : null}
      {empty ? (
        <div className="map-note">
          <p className="map-note-title">Nothing to map yet.</p>
          <p>Tasks and their branches will appear here as you write on the daily page.</p>
        </div>
      ) : null}
      {status === 'ready' && error ? (
        <p className="map-save-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function ConceptMap() {
  return (
    <ReactFlowProvider>
      <MapFlow />
    </ReactFlowProvider>
  )
}