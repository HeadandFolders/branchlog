import { memo } from 'react'
import type { AiComment } from '@shared/ai-comments'
import { useAiComments } from '../store/ai-comments'

const PREVIEW_LENGTH = 60

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat
}

// Overflow past the two newest comments on a task waits here as one small dot, in the
// same place a margin note would sit, so a busy task keeps its own lines readable.
export const AiCommentDot = memo(function AiCommentDot({ comment }: { comment: AiComment }) {
  const showMargin = useAiComments((state) => state.showMargin)
  const text = preview(comment.text)
  return (
    <button
      type="button"
      className="ai-comment ai-dot nodrag nopan"
      data-ai-dot={comment.id}
      aria-label={`AI comment waiting in the margin: ${text}`}
      title={comment.text}
      onClick={() => showMargin(comment.id)}
    >
      <span className="ai-dot-mark" aria-hidden="true" />
    </button>
  )
})
