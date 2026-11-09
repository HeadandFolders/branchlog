import { useAiComments } from '../store/ai-comments'

export function AiStatusNote() {
  const offline = useAiComments((state) => state.offline)
  const error = useAiComments((state) => state.error)
  if (!offline && error === null) return null
  return (
    <p className="text-center text-[12px] text-[var(--text-muted)]" role="status" data-ai-status="">
      {error ?? 'AI is offline. Comments will wait.'}
    </p>
  )
}