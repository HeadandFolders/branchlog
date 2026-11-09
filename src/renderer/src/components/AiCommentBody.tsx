import { memo, useCallback, useState, type FormEvent } from 'react'
import { Axe, Send } from 'lucide-react'
import { textDirection } from '../lib/direction'
import { parseRanges } from '../lib/keep-ranges'
import { useAiComments } from '../store/ai-comments'
import { useAskAi } from '../store/ask-ai'
import { KeepHideText } from './KeepHideText'
import { AiThinkingDots } from './AiThinkingDots'

export const AiCommentBody = memo(function AiCommentBody({ id }: { id: string }) {
  const comment = useAiComments((state) => state.comments.find((item) => item.id === id))
  const replyBusy = useAiComments((state) => state.replyingId !== null)
  const asking = useAskAi((state) => state.requestId !== null)
  const setStatus = useAiComments((state) => state.setStatus)
  const remove = useAiComments((state) => state.remove)
  const sendReply = useAiComments((state) => state.sendReply)
  const setKeptRanges = useAiComments((state) => state.setKeptRanges)
  const [showReplies, setShowReplies] = useState(false)
  const [draft, setDraft] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [selectedText, setSelectedText] = useState<HTMLElement | null>(null)
  const [toolbar, setToolbar] = useState<HTMLSpanElement | null>(null)
  const collapse = useCallback(() => {
    setRevealed(false)
    setSelectedText(null)
  }, [])
  const selectionChanged = useCallback((element: HTMLElement, active: boolean) => {
    setSelectedText((current) => active ? element : current === element ? null : current)
  }, [])

  if (!comment || comment.status === 'resolved') return null

  const inline = comment.side === 'right'
  const busy = asking || replyBusy
  const keptComment = parseRanges(comment.keptRanges).length > 0
  const keptReplies = comment.replies.some((reply) => parseRanges(reply.keptRanges).length > 0)
  const trimmed = keptComment || keptReplies
  const expanded = !trimmed || revealed || selectedText !== null
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || draft.trim() === '') return
    setShowReplies(true)
    const sent = await sendReply(id, draft)
    if (sent) setDraft('')
  }

  return (
    <div
      className={inline ? 'ai-comment ai-answer nodrag' : 'ai-comment'}
      data-ai-comment={id}
      data-ai-answer={inline ? id : undefined}
      data-ai-expanded={expanded}
      data-ai-selecting={selectedText !== null || undefined}
      onPointerOver={(event) => {
        if (event.target instanceof Element && event.target.closest('[data-kept-range]')) setRevealed(true)
      }}
      onMouseLeave={() => setRevealed(false)}
      onFocusCapture={(event) => {
        if (event.target instanceof Element && event.target.matches(':focus-visible')) setRevealed(true)
      }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null) || event.currentTarget.matches(':hover')) return
        setRevealed(false)
      }}
    >
      <p className={`ai-comment-text${!expanded && !keptComment ? ' sr-only' : ''}`} dir={textDirection(comment.text)} data-ai-text="">
        <KeepHideText
          text={comment.text}
          keptRanges={comment.keptRanges}
          onChange={(json) => setKeptRanges(id, null, json)}
          toolbar={toolbar}
          expanded={expanded}
          onKeep={collapse}
          onSelectionChange={selectionChanged}
        />
      </p>
      {(showReplies || trimmed) && comment.replies.length > 0 ? (
        <div className={`ai-reply-thread nowheel${!expanded && !keptReplies ? ' sr-only' : ''}`} data-ai-replies="">
          {comment.replies.map((reply) => (
            <p key={reply.id} className={`${reply.role === 'ai' ? 'ai-reply ai-reply-ai' : 'ai-reply ai-reply-user'}${!expanded && parseRanges(reply.keptRanges).length === 0 ? ' sr-only' : ''}`} dir={textDirection(reply.text)}>
              <span className="ai-reply-role">{reply.role === 'ai' ? 'AI' : 'You'}</span>
              <KeepHideText
                text={reply.text}
                keptRanges={reply.keptRanges}
                onChange={(json) => setKeptRanges(id, reply.id, json)}
                toolbar={toolbar}
                expanded={expanded}
                onKeep={collapse}
                onSelectionChange={selectionChanged}
              />
            </p>
          ))}
        </div>
      ) : null}
      <AiThinkingDots commentId={id} />
      <form className="ai-reply-form nodrag nowheel" onSubmit={(event) => { void submit(event) }}>
        <input
          className="ai-reply-input"
          type="text"
          value={draft}
          placeholder="Write back..."
          aria-label="Write back"
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="ai-reply-send" aria-label="Send reply" disabled={busy || draft.trim() === ''}>
          <Send size={12} />
        </button>
      </form>
      <div className="ai-comment-tools nodrag">
        {comment.replies.length > 0 && !trimmed ? (
          <button type="button" className="ai-tool" onClick={() => setShowReplies((value) => !value)}>
            {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
          </button>
        ) : null}
        {!inline ? (
          <button type="button" className="ai-tool" aria-label="Resolve comment" onClick={() => setStatus(id, 'resolved')}>
            Resolve
          </button>
        ) : null}
        <span ref={setToolbar} className="ai-keep-slot" />
        <button type="button" className="ai-tool ai-delete" aria-label="Delete" onClick={() => remove(id)}>
          <Axe size={12} />
        </button>
      </div>
    </div>
  )
})
