import { SEPARATE_GAP, settleMargin, type MarginSlot, type SeparateMove } from '@shared/separate'
import type { AiComment } from '@shared/ai-comments'
import { engageMargin, notedSize } from './layout-motion'
import { collapsedComments, estimateCommentHeight, marginComments, marginHold } from './margin-stack'
import { useAiComments } from '../store/ai-comments'

// Which comments the margin is showing as dots right now. One call, so every reader
// — the column pass, the collision bodies, the node itself — agrees on the same frame.
export function marginCollapsed(): ReadonlySet<string> {
  const state = useAiComments.getState()
  return collapsedComments(state.comments, state.marginShown)
}

function slotHeight(comment: AiComment, collapsed: boolean): number {
  const measured = notedSize(comment.id)?.height ?? 0
  return measured > 1 ? Math.round(measured) : estimateCommentHeight(comment, collapsed)
}

// The margin as the engine sees it: one slot per open comment, its own height, and its
// rank on the task line it belongs to. The saved position is the spot the settle starts
// from, so a comment the reader dragged to keeps that spot and only what it now covers
// gives way.
export function marginSlots(): MarginSlot[] {
  const state = useAiComments.getState()
  const comments = marginComments(state.comments)
  if (comments.length === 0) return []
  const collapsed = marginCollapsed()
  const hold = marginHold(state.comments)
  return comments.map((comment) => ({
    id: comment.id,
    x: comment.x,
    y: comment.y,
    height: slotHeight(comment, collapsed.has(comment.id)),
    hold: hold.get(comment.id) ?? 0,
  }))
}

export function marginMoves(): SeparateMove[] {
  return settleMargin(marginSlots(), SEPARATE_GAP)
}

// The one call every margin change goes through: a comment arriving, a chat opening or
// closing, a delete, a resolve, a task line growing, a drop after a drag, or a day that
// has just loaded. It only ever reports boxes that truly overlap.
export function settleMarginColumn(): void {
  engageMargin(marginMoves())
}

export function isMarginComment(id: string): boolean {
  return useAiComments
    .getState()
    .comments.some((comment) => comment.id === id && comment.side === 'left' && comment.status === 'open')
}
