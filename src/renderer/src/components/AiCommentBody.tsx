import { memo, useState, type FormEvent } from 'react'
import { Axe, Send } from 'lucide-react'
import { textDirection } from '../lib/direction'
import { useAiComments } from '../store/ai-comments'
import { useAskAi } from '../store/ask-ai'
import { KeepHideText } from './KeepHideText'

export const AiCommentBody = memo(function AiCommentBody({ id }: { id: string }) {
  const comment = useAiComments((state) => state.comments.find((item) => item.id === id))
  const replying = useAiComments((state) => state.replyingId === id)
  const replyBusy = useAiComments((state) => state.replyingId !== null)
  const asking = useAskAi((state) => state.requestId !== null)
  const setStatus = useAiComments((state) => state.setStatus)
  const remove = useAiComments((state) => state.remove)
  const sendReply = useAiComments((state) => state.sendReply)
  const setKeptRanges = useAiComments((state) => state.setKeptRanges)
  const [showReplies, setShowReplies] = useState(false)
  const [draft, setDraft] = useState('')

  if (!comment) return null
  if (comment.status === 'resolved') {
    return (
      <button
        type="button"
        className="ai-resolved-dot nodrag"
        aria-label="Reopen AI comment"
        data-ai-resolved={id}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setStatus(id, 'open')}
      />
    )
  }

  const inline = comment.side === 'right'
  const busy = asking || replyBusy
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || draft.trim() === '') return
    const sent = await sendReply(id, draft)
    if (sent) {
      setDraft('')
      setShowReplies(true)
    }
  }

  return (
    <div className={inline ? 'ai-comment ai-answer nodrag' : 'ai-comment'} data-ai-comment={id} data-ai-answer={inline ? id : undefined}>
      <p className="ai-comment-text" dir={textDirection(comment.text)} data-ai-text="">
        <KeepHideText text={comment.text} keptRanges={comment.keptRanges} onChange={(json) => setKeptRanges(id, null, json)} />
      </p>
      {showReplies && comment.replies.length > 0 ? (
        <div className="ai-reply-thread nowheel" data-ai-replies="">
          {comment.replies.map((reply) => (
            <p key={reply.id} className={reply.role === 'ai' ? 'ai-reply ai-reply-ai' : 'ai-reply ai-reply-user'} dir={textDirection(reply.text)}>
              <span className="ai-reply-role">{reply.role === 'ai' ? 'AI' : 'You'}</span>
              <KeepHideText text={reply.text} keptRanges={reply.keptRanges} onChange={(json) => setKeptRanges(id, reply.id, json)} />
            </p>
          ))}
        </div>
      ) : null}
      <form className="ai-reply-form nodrag nowheel" onSubmit={(event) => { void submit(event) }}>
        <input
          className="ai-reply-input"
          type="text"
          value={draft}
          placeholder={replying ? 'Thinking...' : 'Write back...'}
          aria-label="Write back"
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="ai-reply-send" aria-label="Send reply" disabled={busy || draft.trim() === ''}>
          <Send size={12} />
        </button>
      </form>
      <div className="ai-comment-tools nodrag">
        {comment.replies.length > 0 ? (
          <button type="button" className="ai-tool" onClick={() => setShowReplies((value) => !value)}>
            {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
          </button>
        ) : null}
        {!inline ? (
          <button type="button" className="ai-tool" aria-label="Resolve comment" onClick={() => setStatus(id, 'resolved')}>
            Resolve
          </button>
        ) : null}
        <button type="button" className="ai-tool ai-delete" aria-label="Delete" onClick={() => remove(id)}>
          <Axe size={12} />
        </button>
      </div>
    </div>
  )
})
