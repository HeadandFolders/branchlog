import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BRANCH_LINE_HEIGHT, BRANCH_MIN_WIDTH, BRANCH_WIDTH } from '@shared/branch-size'
import type { Task } from '@shared/types'
import { registerFlowPoint } from '../lib/branch-from'
import { canvasNavigation, keepOwnScroll } from '../lib/canvas-navigation'
import { registerFramePage } from '../lib/viewport'
import { settleFocusRequest, focusSettlePending } from '../lib/focus-field'
import { tempMark } from '@shared/temp-timing'
import { useNotebook } from '../store/notebook'
import { usePreferences } from '../store/preferences'
import { tempCountRender, tempNoteFlowDimensions } from '../temp-first-paint'
import { BranchNode } from './BranchNode'
import { MainListNode } from './MainListNode'

const LIST_WIDTH = 560

const nodeTypes: NodeTypes = {
  mainList: MainListNode,
  branch: BranchNode,
}

function mainListNode(): Node {
  return {
    id: 'main-list',
    type: 'mainList',
    position: { x: 0, y: 0 },
    data: {},
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    style: { pointerEvents: 'all', width: LIST_WIDTH },
  }
}

function buildNodes(tasks: Task[], previous: Node[] = []): Node[] {
  const measured = previous.find((node) => node.id === 'main-list')
  const list = mainListNode()
  if (measured?.measured?.width && measured.measured.height) {
    list.width = measured.measured.width
    list.height = measured.measured.height
  }
  const prior = new Map(previous.map((node) => [node.id, node]))
  const branches = tasks
    .filter((task) => task.side === 'right')
    .map((task): Node => {
      const width = task.width >= BRANCH_MIN_WIDTH ? task.width : BRANCH_WIDTH
      const earlier = prior.get(task.id)
      const node: Node = {
        id: task.id,
        type: 'branch',
        position: { x: task.x, y: task.y },
        data: {},
        draggable: true,
        selectable: true,
        connectable: false,
        focusable: false,
        width,
        style: {
          pointerEvents: 'all',
          width,
          visibility: 'visible',
          minHeight: task.height >= BRANCH_LINE_HEIGHT ? task.height : undefined,
        },
      }
      if (earlier?.selected) node.selected = true
      if (earlier?.measured?.width && earlier.measured.height) node.measured = earlier.measured
      return node
    })
  return [list, ...branches]
}

function buildEdges(tasks: Task[]): Edge[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const edges: Edge[] = []
  for (const task of tasks) {
    if (task.side !== 'right' || !task.parentId) continue
    const parent = byId.get(task.parentId)
    if (!parent) continue
    const fromList = parent.side === 'main'
    edges.push({
      id: `edge-${task.id}`,
      source: fromList ? 'main-list' : parent.id,
      sourceHandle: fromList ? `out-${parent.id}` : 'out',
      target: task.id,
      targetHandle: 'in',
      type: 'default',
      className: 'branch-edge',
      interactionWidth: 12,
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--line)' },
      style: { stroke: 'var(--line)', strokeWidth: 1 },
    })
  }
  return edges
}

function structureKey(tasks: Task[]): string {
  return tasks
    .map(
      (task) =>
        `${task.id}|${task.side}|${task.parentId ?? ''}|${task.x}|${task.y}|${task.width}|${task.height}|${task.orderIndex}`,
    )
    .join(';')
}

function DailyFlow() {
  tempCountRender('DailyFlow')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const draggingId = useRef<string | null>(null)
  const resizingId = useRef<string | null>(null)
  const resizeBaseline = useRef<number | null>(null)
  const swipeToPan = usePreferences((state) => state.swipeToPan)
  const tasks = useNotebook((state) => state.tasks)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const currentDate = useNotebook((state) => state.currentDate)
  const updatePosition = useNotebook((state) => state.updatePosition)
  const [nodes, setNodes] = useState<Node[]>(() => buildNodes(tasks))
  const [edges, setEdges] = useState<Edge[]>(() => buildEdges(tasks))
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const structure = structureKey(tasks)
  const measuredUpdate = useRef(false)

  const { screenToFlowPosition } = useReactFlow()

  const frame = useCallback(() => {
    const instance = instanceRef.current
    const width = wrapperRef.current?.clientWidth ?? 0
    if (!instance || width === 0) return
    instance.setViewport({ x: Math.round((width - LIST_WIDTH) / 2), y: 28, zoom: 1 }, { duration: 0 })
  }, [])

  useEffect(() => {
    usePreferences.getState().load()
  }, [])
  useEffect(() => registerFramePage(frame), [frame])
  useEffect(() => registerFlowPoint(screenToFlowPosition), [screenToFlowPosition])

  useEffect(() => {
    frame()
  }, [currentDate, frame])

  useLayoutEffect(() => {
    if (draggingId.current || resizingId.current) return
    const current = tasksRef.current
    setNodes(buildNodes(current, nodesRef.current))
    setEdges(buildEdges(current))
    tempMark('canvas-rebuild', { tasks: current.length })
  }, [structure])

  useLayoutEffect(() => {
    if (!focusSettlePending()) {
      measuredUpdate.current = false
      return
    }
    if (settleFocusRequest(measuredUpdate.current)) measuredUpdate.current = false
  }, [nodes])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some((change) => change.type === 'dimensions')) {
      measuredUpdate.current = true
      let measured = 0
      for (const change of changes) if (change.type === 'dimensions') measured += 1
      tempNoteFlowDimensions(measured)
    }
    let origin = resizeBaseline.current
    for (const change of changes) {
      if (change.type !== 'dimensions' || change.id === 'main-list') continue
      if (change.resizing) resizingId.current = change.id
      if (change.resizing && change.setAttributes === true && change.dimensions && origin === null) {
        const previous = nodesRef.current.find((node) => node.id === change.id)
        origin = previous?.measured?.height ?? change.dimensions.height
        resizeBaseline.current = origin
      }
    }
    const adjusted = changes.map((change): NodeChange => {
      if (change.type === 'dimensions' && change.id !== 'main-list' && change.setAttributes === true) {
        return { ...change, setAttributes: 'width' }
      }
      return change
    })
    setNodes((current) => {
      const next = applyNodeChanges<Node>(adjusted, current)
      return next.map((node) => {
        const change = changes.find(
          (item) => item.type === 'dimensions' && item.id === node.id && item.setAttributes === true && item.dimensions,
        )
        if (!change || change.type !== 'dimensions' || !change.dimensions || node.id === 'main-list') return node
        const heightChanged = origin !== null && Math.abs(change.dimensions.height - origin) > 0.5
        return {
          ...node,
          style: {
            ...node.style,
            width: change.dimensions.width,
            minHeight: heightChanged
              ? Math.max(change.dimensions.height, BRANCH_LINE_HEIGHT)
              : node.style?.minHeight,
          },
        }
      })
    })
    if (changes.some((change) => change.type === 'dimensions' && change.resizing === false)) {
      resizingId.current = null
      resizeBaseline.current = null
    }
  }, [])

  return (
    <div
      ref={wrapperRef}
      className="h-full w-full"
      data-swipe-pan={swipeToPan ? '1' : '0'}
      onWheelCapture={keepOwnScroll}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={(_event, node) => {
          draggingId.current = node.id
        }}
        onNodeDragStop={(_event, node) => {
          draggingId.current = null
          if (node.id === 'main-list') return
          updatePosition(node.id, node.position.x, node.position.y)
        }}
        onInit={(instance) => {
          instanceRef.current = instance
          frame()
          const viewport = instance.getViewport()
          tempMark('react-flow-init', {
            x: Math.round(viewport.x),
            y: Math.round(viewport.y),
            zoom: viewport.zoom,
            nodes: instance.getNodes().length,
          })
        }}
        fitView={false}
        minZoom={0.5}
        maxZoom={1.6}
        {...canvasNavigation(swipeToPan)}
        zoomOnDoubleClick={false}
        panOnDrag
        selectionOnDrag={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        style={{ background: 'var(--bg)' }}
      />
    </div>
  )
}

export function DailyCanvas() {
  tempCountRender('DailyCanvas')
  return (
    <ReactFlowProvider>
      <DailyFlow />
    </ReactFlowProvider>
  )
}
