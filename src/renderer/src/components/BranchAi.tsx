import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { MessageCircle, X } from 'lucide-react'
import { useAiComments } from '../store/ai-comments'
import { useAiSettings } from '../store/ai-settings'
import { useAskAi } from '../store/ask-ai'
import { useNotebook } from '../store/notebook'
import { AiCommentBody } from './AiCommentBody'

export const BranchAi = memo(function BranchAi({ taskId }: { taskId: string }) {
  const answerIds = useAiComments(useShallow((state) => state.comments.filter((item) => item.taskId === taskId && item.side === 'right').map((item) => item.id)))
  const replyBusy = useAiComments((state) => state.replyingId !== null)
  const enabled = useAiSettings((state) => state.settings.enabled)
  const eligible = useNotebook((state) => {
    const task = state.tasks.find((item) => item.id === taskId)
    return Boolean(task && task.text.trim() !== '' && !task.done && task.droppedAt === null)
  })
  const thinking = useAskAi((state) => state.taskId === taskId)
  const message = useAskAi((state) => state.messages[taskId])
  const ask = useAskAi((state) => state.ask)
  const cancel = useAskAi((state) => state.cancel)

  return (
    <>
      {enabled && eligible ? (
        <button
          type="button"
          className="branch-ask-ai ai-tool nodrag nopan"
          aria-label={thinking ? 'Cancel AI answer' : 'Ask AI'}
          title={thinking ? 'Cancel AI answer' : 'Ask AI'}
          disabled={replyBusy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation()
            if (thinking) cancel()
            else void ask(taskId)
          }}
        >
          {thinking ? <X size={12} /> : <MessageCircle size={12} />}
        </button>
      ) : null}
      {thinking ? <p className="branch-ai-note" role="status" data-ai-asking={taskId}>Thinking...</p> : null}
      {message ? <p className="branch-ai-note" role="status" data-ai-answer-note={taskId}>{message}</p> : null}
      {answerIds.map((id) => <AiCommentBody key={id} id={id} />)}
    </>
  )
})
