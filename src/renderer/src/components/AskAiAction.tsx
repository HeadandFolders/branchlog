import { memo } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { useAiComments } from '../store/ai-comments'
import { useAskAi } from '../store/ask-ai'
import { TASK_ACTION_ICON, TaskActionButton } from './TaskActionButton'

export const AskAiAction = memo(function AskAiAction({ taskId }: { taskId: string }) {
  const replyBusy = useAiComments((state) => state.replyingId !== null)
  const thinking = useAskAi((state) => state.taskId === taskId)
  const ask = useAskAi((state) => state.ask)
  const cancel = useAskAi((state) => state.cancel)
  const label = thinking ? 'Cancel AI answer' : 'Ask AI'

  return (
    <TaskActionButton
      targetId={taskId}
      action="ask-ai"
      label={label}
      className="branch-ask-ai"
      disabled={replyBusy}
      onActivate={() => {
        if (thinking) cancel()
        else void ask(taskId)
      }}
    >
      {thinking ? <X {...TASK_ACTION_ICON} /> : <MessageCircle {...TASK_ACTION_ICON} />}
    </TaskActionButton>
  )
})
