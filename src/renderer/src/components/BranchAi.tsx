import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAiComments } from '../store/ai-comments'
import { useAskAi } from '../store/ask-ai'
import { AiCommentBody } from './AiCommentBody'

export const BranchAi = memo(function BranchAi({ taskId }: { taskId: string }) {
  const answerIds = useAiComments(useShallow((state) => state.comments.filter((item) => item.taskId === taskId && item.side === 'right').map((item) => item.id)))
  const thinking = useAskAi((state) => state.taskId === taskId)
  const message = useAskAi((state) => state.messages[taskId])

  return (
    <>
      {thinking ? <p className="branch-ai-note" role="status" data-ai-asking={taskId}>Thinking...</p> : null}
      {message ? <p className="branch-ai-note" role="status" data-ai-answer-note={taskId}>{message}</p> : null}
      {answerIds.map((id) => <AiCommentBody key={id} id={id} />)}
    </>
  )
})
