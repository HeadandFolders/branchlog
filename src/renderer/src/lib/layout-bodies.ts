import { BRANCH_LINE_HEIGHT, BRANCH_WIDTH } from '@shared/branch-size'
import type { AiComment } from '@shared/ai-comments'
import type { SeparateBody } from '@shared/separate'
import type { Task } from '@shared/types'
import type { Node } from '@xyflow/react'
import { AI_COMMENT_WIDTH } from './canvas-ai'
import { notedSize } from './layout-motion'

export function anchorId(taskId: string): string {
  return `anchor:${taskId}`
}

export function measureAnchors(
  toFlow: (point: { x: number; y: number }) => { x: number; y: number },
): SeparateBody[] {
  const lines = document.querySelectorAll<HTMLElement>('.react-flow__node-mainList .task-line')
  const bodies: SeparateBody[] = []
  for (const line of lines) {
    const id = line.querySelector<HTMLElement>('[data-task-id]')?.dataset.taskId
    if (!id) continue
    const rect = line.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    const origin = toFlow({ x: rect.left, y: rect.top })
    const far = toFlow({ x: rect.right, y: rect.bottom })
    bodies.push({
      id: anchorId(id),
      x: origin.x,
      y: origin.y,
      width: Math.max(1, far.x - origin.x),
      height: Math.max(1, far.y - origin.y),
      fixed: true,
      pinned: false,
      parentId: null,
    })
  }
  return bodies
}

function nodeSize(node: Node, fallbackWidth: number, fallbackHeight: number): { width: number; height: number } {
  const noted = notedSize(node.id)
  const width = noted?.width ?? node.measured?.width ?? node.width ?? fallbackWidth
  const measuredHeight = node.measured?.height && node.measured.height > 1 ? node.measured.height : fallbackHeight
  const height = noted?.height ?? measuredHeight
  return { width: Math.max(1, width), height: Math.max(1, height) }
}

export function collectBodies(
  nodes: Node[],
  tasks: Task[],
  images: { id: string; width: number; height: number }[],
  anchors: SeparateBody[],
  comments: AiComment[] = [],
): SeparateBody[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const bodies: SeparateBody[] = [...anchors]
  for (const task of tasks) {
    if (task.side !== 'right') continue
    const node = nodeById.get(task.id)
    if (!node) continue
    const size = nodeSize(node, task.width >= 1 ? task.width : BRANCH_WIDTH, task.height >= BRANCH_LINE_HEIGHT ? task.height : BRANCH_LINE_HEIGHT)
    const parent = task.parentId ? taskById.get(task.parentId) : undefined
    bodies.push({
      id: task.id,
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
      fixed: false,
      pinned: false,
      parentId: parent ? (parent.side === 'main' ? anchorId(parent.id) : parent.id) : null,
    })
  }
  for (const image of images) {
    const node = nodeById.get(image.id)
    if (!node) continue
    const size = nodeSize(node, image.width, image.height)
    bodies.push({
      id: image.id,
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
      fixed: false,
      pinned: false,
      parentId: null,
    })
  }
  for (const comment of comments) {
    const node = nodeById.get(comment.id)
    if (!node) continue
    const size = nodeSize(node, AI_COMMENT_WIDTH, 40)
    bodies.push({
      id: comment.id,
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
      fixed: false,
      pinned: false,
      parentId: null,
    })
  }
  return bodies
}
