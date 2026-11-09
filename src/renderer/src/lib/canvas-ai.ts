import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { AiComment } from '@shared/ai-comments'
import type { Task } from '@shared/types'

export const AI_COMMENT_WIDTH = 240
export const AI_COMMENT_GAP = 32

export function commentNode(comment: AiComment, earlier: Node | undefined): Node {
  const width = AI_COMMENT_WIDTH
  const node: Node = {
    id: comment.id,
    type: 'aiComment',
    position: { x: comment.x, y: comment.y },
    data: {},
    draggable: true,
    selectable: true,
    connectable: false,
    focusable: false,
    width,
    style: { pointerEvents: 'all', width },
  }
  if (earlier?.selected) node.selected = true
  if (earlier?.measured?.width && earlier.measured.height) node.measured = earlier.measured
  return node
}

export function buildCommentEdges(comments: AiComment[], tasks: Task[]): Edge[] {
  const taskIds = new Set(tasks.filter((task) => task.side === 'main').map((task) => task.id))
  const edges: Edge[] = []
  for (const comment of comments) {
    if (comment.side !== 'left' || comment.status !== 'open' || !taskIds.has(comment.taskId)) continue
    edges.push({
      id: `edge-ai-${comment.id}`,
      source: comment.id,
      sourceHandle: 'out',
      target: 'main-list',
      targetHandle: `in-${comment.taskId}`,
      type: 'default',
      className: 'ai-edge',
      interactionWidth: 0,
      markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: 'var(--ai-line)' },
      style: { stroke: 'var(--ai-line)', strokeWidth: 1 },
    })
  }
  return edges
}

export function commentStructureKey(comments: AiComment[]): string {
  return comments
    .filter((comment) => comment.side === 'left')
    .map((comment) => `${comment.id}|${comment.x}|${comment.y}|${comment.status}|${comment.replies.length}`)
    .join(';')
}