import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { registerFramePage } from '../lib/viewport'
import { useNotebook } from '../store/notebook'
import { MainListNode } from './MainListNode'

const LIST_WIDTH = 560

const nodes: Node[] = [
  {
    id: 'main-list',
    type: 'mainList',
    position: { x: 0, y: 0 },
    data: {},
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    style: { pointerEvents: 'all', width: LIST_WIDTH },
  },
]

const edges: Edge[] = []

const nodeTypes: NodeTypes = {
  mainList: MainListNode,
}

function DailyFlow() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const currentDate = useNotebook((state) => state.currentDate)

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

  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
        elementsSelectable={false}
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
