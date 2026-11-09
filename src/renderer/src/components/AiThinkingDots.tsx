import { useAiComments } from '../store/ai-comments'

export function AiThinkingDots({ taskId }: { taskId: string }) {
  const thinking = useAiComments((state) => state.thinkingTaskId === taskId)
  if (!thinking) return null
  return (
    <span className="ai-thinking" role="status" aria-label="AI is thinking" data-ai-thinking="">
      <span />
      <span />
      <span />
    </span>
  )
}