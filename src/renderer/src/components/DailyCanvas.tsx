import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Task } from '@shared/types'
import { registerFramePage } from '../lib/viewport'
import { useNotebook } from '../store/notebook'
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

function buildNodes(tasks: Task[]): Node[] {
  const branches = tasks
    .filter((task) => task.side === 'right')
    .map(
      (task): Node => ({
        id: task.id,
        type: 'branch',
        position: { x: task.x, y: task.y },
        data: {},
        draggable: true,
        selectable: true,
        connectable: false,
        focusable: false,
        style: { pointerEvents: 'all', width: 'max-content', maxWidth: 320 },
      }),
    )
  return [mainListNode(), ...branches]
}

function buildEdges(tasks: Task[]): Edge[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const edges: Edge[] = []
  for (const task of tasks) {
    if (task.side !== 'right' || !task.parentId) continue
    const parent = byId.get(task.parentId)
    if (!parent) continue
    edges.push({
      id: `edge-${task.id}`,
      source: task.id,
      sourceHandle: 'out',
      target: parent.side === 'main' ? 'main-list' : parent.id,
      targetHandle: parent.side === 'main' ? `in-${parent.id}` : 'in',
      type: 'default',
      className: 'branch-edge',
      interactionWidth: 12,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--line)' },
      style: { stroke: 'var(--line)', strokeWidth: 1 },
    })
  }
  return edges
}

function structureKey(tasks: Task[]): string {
  return tasks
    .map((task) => `${task.id}|${task.side}|${task.parentId ?? ''}|${task.x}|${task.y}|${task.orderIndex}`)
    .join(';')
}

function DailyFlow() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const draggingId = useRef<string | null>(null)
  const tasks = useNotebook((state) => state.tasks)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const currentDate = useNotebook((state) => state.currentDate)
  const updatePosition = useNotebook((state) => state.updatePosition)
  const [nodes, setNodes] = useState<Node[]>(() => buildNodes(tasks))
  const [edges, setEdges] = useState<Edge[]>(() => buildEdges(tasks))
  const structure = structureKey(tasks)

  const frame = useCallback(() => {
    const instance = instanceRef.current
    const width = wrapperRef.current?.clientWidth ?? 0
    if (!instance || width === 0) return
    instance.setViewport({ x: Math.round((width - LIST_WIDTH) / 2), y: 28, zoom: 1 }, { duration: 0 })
  }, [])

  useEffect(() => registerFramePage(frame), [frame])

  useEffect(() => {
    frame()
  }, [currentDate, frame])

  useEffect(() => {
    if (draggingId.current) return
    const current = tasksRef.current
    setNodes(buildNodes(current))
    setEdges(buildEdges(current))
  }, [structure])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  return (
    <div ref={wrapperRef} className="h-full w-full">
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
        }}
        fitView={false}
        minZoom={0.5}
        maxZoom={1.6}
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
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
  return (
    <ReactFlowProvider>
      <DailyFlow />
    </ReactFlowProvider>
  )
}
