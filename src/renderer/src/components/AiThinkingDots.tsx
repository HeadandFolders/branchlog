import { useAiComments } from '../store/ai-comments'

export function AiThinkingDots({ taskId, commentId }: { taskId?: string; commentId?: string }) {
  const thinking = useAiComments((state) => taskId ? state.thinkingTaskId === taskId : state.replyingId === commentId)
  if (!thinking) return null
  return (
    <span
      className={commentId ? 'ai-thinking ai-reply-thinking' : 'ai-thinking'}
      role="status"
      aria-label={commentId ? 'AI is replying' : 'AI is thinking'}
      data-ai-thinking=""
      data-ai-replying={commentId}
    >
      <span />
      <span />
      <span />
    </span>
  )
}