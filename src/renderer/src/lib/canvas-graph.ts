import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { AiComment } from '@shared/ai-comments'
import { BRANCH_LINE_HEIGHT, BRANCH_MIN_WIDTH, BRANCH_WIDTH } from '@shared/branch-size'
import type { CanvasImage, Task } from '@shared/types'
import { commentNode } from './canvas-ai'

const LIST_WIDTH = 560

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

function branchNode(task: Task, earlier: Node | undefined): Node {
  const width = task.width >= BRANCH_MIN_WIDTH ? task.width : BRANCH_WIDTH
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
}

function imageNode(image: CanvasImage, earlier: Node | undefined): Node {
  const node: Node = {
    id: image.id,
    type: 'image',
    position: { x: image.x, y: image.y },
    data: {},
    draggable: true,
    selectable: true,
    connectable: false,
    focusable: false,
    width: image.width,
    height: image.height,
    style: { width: image.width, height: image.height },
  }
  if (earlier?.selected) node.selected = true
  if (earlier?.measured?.width && earlier.measured.height) node.measured = earlier.measured
  return node
}

export function buildCanvasNodes(
  tasks: Task[],
  images: CanvasImage[],
  previous: Node[] = [],
  comments: AiComment[] = [],
): Node[] {
  const measured = previous.find((node) => node.id === 'main-list')
  const list = mainListNode()
  if (measured?.measured?.width && measured.measured.height) {
    list.width = measured.measured.width
    list.height = measured.measured.height
  }
  const prior = new Map(previous.map((node) => [node.id, node]))
  const branches = tasks.filter((task) => task.side === 'right').map((task) => branchNode(task, prior.get(task.id)))
  const pictures = images.map((image) => imageNode(image, prior.get(image.id)))
  const margins = comments.map((comment) => commentNode(comment, prior.get(comment.id)))
  return [list, ...branches, ...pictures, ...margins]
}

export function buildCanvasEdges(tasks: Task[]): Edge[] {
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
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--edge)' },
      style: { stroke: 'var(--edge)', strokeWidth: 1 },
    })
  }
  return edges
}

export function taskStructureKey(tasks: Task[]): string {
  return tasks
    .map(
      (task) =>
        `${task.id}|${task.side}|${task.parentId ?? ''}|${task.x}|${task.y}|${task.width}|${task.height}|${task.orderIndex}`,
    )
    .join(';')
}

export function imageStructureKey(images: CanvasImage[]): string {
  return images
    .map(
      (image) =>
        `${image.id}|${image.x}|${image.y}|${image.width}|${image.height}|${image.cropLeft}|${image.cropTop}|${image.cropRight}|${image.cropBottom}`,
    )
    .join(';')
}

export function overlayPositions(nodes: Node[], positions: ReadonlyMap<string, { x: number; y: number }> | null): Node[] {
  if (!positions || positions.size === 0) return nodes
  return nodes.map((node) => {
    const position = positions.get(node.id)
    if (!position) return node
    if (node.position.x === position.x && node.position.y === position.y) return node
    return { ...node, position: { x: position.x, y: position.y } }
  })
}
