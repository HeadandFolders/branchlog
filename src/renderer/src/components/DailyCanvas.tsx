import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BRANCH_LINE_HEIGHT } from '@shared/branch-size'
import { settleFocusRequest, focusSettlePending } from '../lib/focus-field'
import { registerFlowPoint } from '../lib/branch-from'
import { buildCanvasEdges, buildCanvasNodes, imageStructureKey, overlayPositions, taskStructureKey } from '../lib/canvas-graph'
import { buildCommentEdges, commentStructureKey } from '../lib/canvas-ai'
import { collectBodies, measureAnchors } from '../lib/layout-bodies'
import { isMarginComment, settleMarginColumn } from '../lib/margin-layout'
import {
  engageLayout,
  heldPositions,
  installLayout,
  layoutRestoreEpoch,
  liveLayout,
  noteNodeSize,
  rememberNodeSize,
  resetLayoutBaseline,
} from '../lib/layout-motion'
import { canvasNavigation, keepOwnScroll } from '../lib/canvas-navigation'
import { cancelReveal, installReveal } from '../lib/reveal-viewport'
import { registerFramePage } from '../lib/viewport'
import { tempMark } from '@shared/temp-timing'
import { pushImageHistory } from '../store/history'
import { useAiComments } from '../store/ai-comments'
import { useImages } from '../store/images'
import { commitLayoutMoves } from '../store/layout-commit'
import { layoutAfterWrite, layoutBeforeWrite } from '../store/layout-bridge'
import { useNotebook } from '../store/notebook'
import { autoSeparateEnabled, usePreferences } from '../store/preferences'
import { tempCountRender, tempNoteFlowDimensions } from '../temp-first-paint'
import { AiCommentNode } from './AiCommentNode'
import { BranchNode } from './BranchNode'
import { ImageDeleteKeys } from './ImageDeleteKeys'
import { ImageNode } from './ImageNode'
import { MainListNode } from './MainListNode'

const LIST_WIDTH = 560

const nodeTypes: NodeTypes = {
  mainList: MainListNode,
  branch: BranchNode,
  image: ImageNode,
  aiComment: AiCommentNode,
}

function DailyFlow() {
  tempCountRender('DailyFlow')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const draggingId = useRef<string | null>(null)
  const resizingId = useRef<string | null>(null)
  const resizeBaseline = useRef<number | null>(null)
  const seenIds = useRef(new Set<string>())
  const bootedDate = useRef('')
  const imageBoot = useRef('')
  const restoreSeen = useRef(0)
  const tasks = useNotebook((state) => state.tasks)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const images = useImages((state) => state.images)
  const imagesReady = useImages((state) => state.ready)
  const imagesRef = useRef(images)
  imagesRef.current = images
  const comments = useAiComments(useShallow((state) => state.comments.filter((comment) => comment.side === 'left')))
  const commentsRef = useRef(comments)
  commentsRef.current = comments
  const ready = useNotebook((state) => state.ready)
  const currentDate = useNotebook((state) => state.currentDate)
  const updatePosition = useNotebook((state) => state.updatePosition)
  const [nodes, setNodes] = useState<Node[]>(() => buildCanvasNodes(tasks, images))
  const [edges, setEdges] = useState<Edge[]>(() => buildCanvasEdges(tasks))
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const structure = taskStructureKey(tasks)
  const pictures = imageStructureKey(images)
  const margins = commentStructureKey(comments)
  const measuredUpdate = useRef(false)
  const { screenToFlowPosition } = useReactFlow()
  const swipeToPan = usePreferences((state) => state.swipeToPan)
  const highlightCarried = usePreferences((state) => state.highlightCarried)

  const frame = useCallback(() => {
    cancelReveal()
    const instance = instanceRef.current
    const width = wrapperRef.current?.clientWidth ?? 0
    if (!instance || width === 0) return
    instance.setViewport({ x: Math.round((width - LIST_WIDTH) / 2), y: 28, zoom: 1 }, { duration: 0 })
  }, [])

  useEffect(() => registerFramePage(frame), [frame])
  useEffect(() => registerFlowPoint(screenToFlowPosition), [screenToFlowPosition])
  useEffect(
    () =>
      installReveal({
        viewport: () => instanceRef.current?.getViewport() ?? null,
        apply: (viewport) => {
          void instanceRef.current?.setViewport(viewport, { duration: 0 })
        },
        pane: () => wrapperRef.current,
      }),
    [],
  )
  useEffect(() => {
    frame()
  }, [currentDate, frame])

  const apply = useCallback((positions: ReadonlyMap<string, { x: number; y: number }>) => {
    setNodes((current) => {
      let changed = false
      const next = current.map((node) => {
        const position = positions.get(node.id)
        if (!position || (position.x === node.position.x && position.y === node.position.y)) return node
        changed = true
        return { ...node, position: { x: position.x, y: position.y } }
      })
      if (!changed) return current
      nodesRef.current = next
      return next
    })
  }, [])

  const reset = useCallback(() => {
    const next = buildCanvasNodes(tasksRef.current, imagesRef.current, nodesRef.current, commentsRef.current)
    nodesRef.current = next
    setNodes(next)
  }, [])

  useEffect(() => {
    return installLayout({
      bodies: () => collectBodies(nodesRef.current, tasksRef.current, imagesRef.current, measureAnchors(screenToFlowPosition), commentsRef.current),
      positions: () => new Map(nodesRef.current.map((node) => [node.id, { x: node.position.x, y: node.position.y }])),
      apply,
      reset,
      commit: commitLayoutMoves,
      enabled: autoSeparateEnabled,
    })
  }, [apply, reset, screenToFlowPosition])

  useLayoutEffect(() => {
    if (draggingId.current || resizingId.current) return
    const current = tasksRef.current
    const picturesNow = imagesRef.current
    const commentsNow = commentsRef.current
    const built = overlayPositions(buildCanvasNodes(current, picturesNow, nodesRef.current, commentsNow), heldPositions())
    nodesRef.current = built
    setNodes(built)
    setEdges([...buildCanvasEdges(current), ...buildCommentEdges(commentsNow, current)])
    tempMark('canvas-rebuild', { tasks: current.length })
    if (!ready) return
    // The margin has its own pass: one column, real heights, and a box that only
    // moves when it truly overlaps the one above it. It runs whatever else changed,
    // because a comment arriving, a chat opening, a task line growing or a delete is
    // a margin change too — and on a day that has just loaded or been restored, it is
    // how positions saved before this fix stop painting on top of each other.
    const settle = (): void => settleMarginColumn()
    const epoch = layoutRestoreEpoch()
    if (epoch !== restoreSeen.current) {
      restoreSeen.current = epoch
      seenIds.current = new Set([
        ...current.filter((task) => task.side === 'right').map((task) => task.id),
        ...picturesNow.map((image) => image.id),
        ...commentsNow.map((comment) => comment.id),
      ])
      resetLayoutBaseline()
      settle()
      return
    }
    if (bootedDate.current !== currentDate) {
      bootedDate.current = currentDate
      imageBoot.current = ''
      seenIds.current = new Set([
        ...current.filter((task) => task.side === 'right').map((task) => task.id),
        ...commentsNow.map((comment) => comment.id),
      ])
      resetLayoutBaseline()
      settle()
      return
    }
    if (imagesReady && imageBoot.current !== currentDate) {
      imageBoot.current = currentDate
      for (const image of picturesNow) seenIds.current.add(image.id)
    }
    const fresh = [
      ...current.filter((task) => task.side === 'right' && !seenIds.current.has(task.id)).map((task) => task.id),
      ...picturesNow.filter((image) => !seenIds.current.has(image.id)).map((image) => image.id),
    ]
    for (const comment of commentsNow) seenIds.current.add(comment.id)
    settle()
    const newest = fresh.at(-1)
    if (!newest || !autoSeparateEnabled()) return
    const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(newest)}"]`)
    const zoom = instanceRef.current?.getZoom() || 1
    if (element && zoom > 0 && element.offsetWidth > 0 && element.offsetHeight > 0) {
      rememberNodeSize(newest, element.offsetWidth / zoom, element.offsetHeight / zoom)
    }
    engageLayout(newest, false)
  }, [currentDate, imagesReady, margins, pictures, ready, structure])

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
    const imageIds = new Set(imagesRef.current.map((image) => image.id))
    const adjusted = changes.map((change): NodeChange => {
      if (
        change.type === 'dimensions' &&
        change.id !== 'main-list' &&
        !imageIds.has(change.id) &&
        change.setAttributes === true
      ) {
        return { ...change, setAttributes: 'width' }
      }
      return change
    })
    setNodes((current) => {
      const next = applyNodeChanges<Node>(adjusted, current)
      const sized = next.map((node) => {
        const change = changes.find(
          (item) => item.type === 'dimensions' && item.id === node.id && item.setAttributes === true && item.dimensions,
        )
        if (!change || change.type !== 'dimensions' || !change.dimensions || node.id === 'main-list') return node
        if (imageIds.has(node.id)) {
          return {
            ...node,
            style: { ...node.style, width: change.dimensions.width, height: change.dimensions.height },
          }
        }
        const heightChanged = origin !== null && Math.abs(change.dimensions.height - origin) > 0.5
        return {
          ...node,
          style: {
            ...node.style,
            width: change.dimensions.width,
            minHeight: heightChanged ? Math.max(change.dimensions.height, BRANCH_LINE_HEIGHT) : node.style?.minHeight,
          },
        }
      })
      nodesRef.current = sized
      return sized
    })
    let marginSized = false
    for (const change of changes) {
      if (change.type !== 'dimensions' || change.id === 'main-list' || !change.dimensions) continue
      // A comment box grows as its chat opens and shrinks as it closes. The margin
      // pass takes that measurement straight away, instead of recording it quietly and
      // leaving the neighbours painted over until something else moves.
      if (isMarginComment(change.id)) {
        rememberNodeSize(change.id, change.dimensions.width, change.dimensions.height)
        marginSized = true
        continue
      }
      noteNodeSize(change.id, change.dimensions.width, change.dimensions.height, change.resizing === true)
    }
    if (marginSized) settleMarginColumn()
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
      data-carried-highlight={highlightCarried ? '1' : '0'}
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
        onNodeDrag={(_event, node) => {
          if (node.id === 'main-list' || !autoSeparateEnabled()) return
          liveLayout(node.id)
        }}
        onNodeDragStop={(_event, node) => {
          draggingId.current = null
          if (node.id === 'main-list') return
          const comment = commentsRef.current.find((item) => item.id === node.id)
          if (comment) {
            if (comment.x !== node.position.x || comment.y !== node.position.y) {
              useAiComments.getState().move(node.id, node.position.x, node.position.y)
              commitLayoutMoves([{ id: node.id, x: node.position.x, y: node.position.y }], node.id)
              // The dropped box keeps the spot the reader chose. Only what it now
              // covers gives way.
              settleMarginColumn()
            }
            return
          }
          const image = imagesRef.current.find((item) => item.id === node.id)
          if (image) {
            const phase = layoutBeforeWrite(node.id)
            if (image.x !== node.position.x || image.y !== node.position.y) {
              const before = imagesRef.current.map((item) => ({ ...item }))
              useImages.getState().move(node.id, node.position.x, node.position.y)
              pushImageHistory(before, useImages.getState().images)
            }
            if (phase === 'defer') layoutAfterWrite()
            else if (image.x !== node.position.x || image.y !== node.position.y) {
              commitLayoutMoves([{ id: node.id, x: node.position.x, y: node.position.y }], node.id)
            }
            return
          }
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
      <ImageDeleteKeys />
    </ReactFlowProvider>
  )
}
