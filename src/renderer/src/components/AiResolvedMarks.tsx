import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAiComments } from '../store/ai-comments'

export const AiResolvedMarks = memo(function AiResolvedMarks({ taskId }: { taskId: string }) {
  const comments = useAiComments(useShallow((state) => state.comments.filter(
    (comment) => comment.side === 'left' && comment.taskId === taskId && comment.status === 'resolved',
  )))
  const setStatus = useAiComments((state) => state.setStatus)
  if (comments.length === 0) return null
  return (
    <span className="ai-resolved-marks nodrag nopan">
      {comments.map((comment) => (
        <button
          key={comment.id}
          type="button"
          className="ai-resolved-dot nodrag nopan"
          aria-label="Reopen AI comment"
          title={`Resolved AI comment: ${comment.text}`}
          data-ai-resolved={comment.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation()
            setStatus(comment.id, 'open')
          }}
        />
      ))}
    </span>
  )
})
