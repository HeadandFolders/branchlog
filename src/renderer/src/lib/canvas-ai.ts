import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { AiComment } from '@shared/ai-comments'
import type { Task } from '@shared/types'

export const AI_COMMENT_WIDTH = 240
export const AI_COMMENT_GAP = 32
// A comment is placed with its own first line level with the task line it belongs to:
// the checkbox centre sits 19px into a task row, the first text line 12px into a
// comment box. Level lines are what keep the arrow a short straight run.
export const AI_COMMENT_LINE_OFFSET = 7

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
      // A step, not a swing: the vertical run lands in the 32px gutter between the
      // margin and the list, so a comment pushed away from its line still never draws
      // its arrow over anybody's text.
      type: 'smoothstep',
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