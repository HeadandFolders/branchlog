import { create } from 'zustand'
import type { AiComment } from '@shared/ai-comments'
import { pushCommentHistory, setCommentRemovalHandler, setCommentRestorer, setHistoryPrepare } from './history'

interface AiCommentsState {
  date: string
  comments: AiComment[]
  // Comments the reader opened out of the dot row for this session. Overflow past the
  // two newest on a task shows as a dot until it is asked for, and nothing else.
  marginShown: ReadonlySet<string>
  ready: boolean
  thinkingTaskId: string | null
  replyingId: string | null
  offline: boolean
  error: string | null
  adopt: (date: string, comments: AiComment[]) => void
  showMargin: (id: string) => void
  move: (id: string, x: number, y: number) => void
  place: (moves: readonly { id: string; x: number; y: number }[]) => void
  forgetTasks: (taskIds: ReadonlySet<string>) => void
  revive: (comments: AiComment[]) => void
  replace: (comments: AiComment[]) => void
  setStatus: (id: string, status: 'open' | 'resolved') => void
  setKeptRanges: (commentId: string, replyId: string | null, keptRanges: string) => void
  remove: (id: string) => void
  sendReply: (id: string, text: string) => Promise<boolean>
  request: (taskId: string, text: string, x: number, y: number) => Promise<void>
}

let latestRequest = ''

interface PendingKept {
  commentId: string
  replyId: string | null
  keptRanges: string
  timer: number
}

const pendingKept = new Map<string, PendingKept>()

function keptKey(commentId: string, replyId: string | null): string {
  return replyId ? `${commentId}/${replyId}` : commentId
}

function writeKept(pending: PendingKept): void {
  try {
    const wrote = window.branchlog.ai.setKeptRangesSync({
      commentId: pending.commentId,
      replyId: pending.replyId,
      keptRanges: pending.keptRanges,
    })
    if (!wrote.ok) useAiComments.setState({ error: 'Could not save that kept text.' })
  } catch (error) {
    console.error(error)
    useAiComments.setState({ error: 'Could not save that kept text.' })
  }
}

export function flushKeptWrites(): void {
  for (const pending of pendingKept.values()) {
    clearTimeout(pending.timer)
    writeKept(pending)
  }
  pendingKept.clear()
}

function cancelKeptWrites(commentIds: ReadonlySet<string>): void {
  for (const [key, pending] of pendingKept) {
    if (!commentIds.has(pending.commentId)) continue
    clearTimeout(pending.timer)
    pendingKept.delete(key)
  }
}

function scheduleKeptWrite(commentId: string, replyId: string | null, keptRanges: string): void {
  const key = keptKey(commentId, replyId)
  const existing = pendingKept.get(key)
  if (existing) clearTimeout(existing.timer)
  const timer = window.setTimeout(() => {
    const pending = pendingKept.get(key)
    if (!pending) return
    pendingKept.delete(key)
    writeKept(pending)
  }, 200)
  pendingKept.set(key, { commentId, replyId, keptRanges, timer })
}

export const useAiComments = create<AiCommentsState>((set, get) => ({
  date: '',
  comments: [],
  marginShown: new Set<string>(),
  ready: false,
  thinkingTaskId: null,
  replyingId: null,
  offline: false,
  error: null,

  adopt: (date, comments) => {
    latestRequest = ''
    flushKeptWrites()
    set({
      date,
      comments,
      marginShown: new Set(),
      ready: true,
      thinkingTaskId: null,
      replyingId: null,
      offline: false,
      error: null,
    })
  },

  showMargin: (id) =>
    set((state) => {
      if (state.marginShown.has(id)) return state
      const marginShown = new Set(state.marginShown)
      marginShown.add(id)
      return { marginShown }
    }),

  move: (id, x, y) => {
    set((state) => ({
      comments: state.comments.map((comment) => (comment.id === id ? { ...comment, x, y } : comment)),
    }))
  },

  place: (moves) => {
    if (moves.length === 0) return
    const moved = new Map(moves.map((move) => [move.id, move]))
    set((state) => ({
      comments: state.comments.map((comment) => {
        const next = moved.get(comment.id)
        return next ? { ...comment, x: next.x, y: next.y } : comment
      }),
    }))
  },

  forgetTasks: (taskIds) => {
    const gone = new Set(get().comments.filter((comment) => taskIds.has(comment.taskId)).map((comment) => comment.id))
    cancelKeptWrites(gone)
    set((state) => ({
      comments: state.comments.filter((comment) => !taskIds.has(comment.taskId)),
      thinkingTaskId: state.thinkingTaskId && taskIds.has(state.thinkingTaskId) ? null : state.thinkingTaskId,
    }))
  },

  revive: (comments) => {
    set((state) => {
      const have = new Set(state.comments.map((comment) => comment.id))
      const back = comments.filter((comment) => !have.has(comment.id))
      if (back.length === 0) return state
      return { comments: [...state.comments, ...back] }
    })
  },

  replace: (comments) => {
    const date = get().date
    set({ comments })
    const wrote = window.branchlog.ai.replaceCommentsSync(date, comments)
    if (!wrote.ok) set({ error: 'Could not undo that edit.' })
  },

  setStatus: (id, status) => {
    const wrote = window.branchlog.ai.setCommentStatusSync(id, status)
    if (!wrote.ok) {
      set({ error: 'Could not update that comment.' })
      return
    }
    set((state) => ({
      comments: state.comments.map((comment) => (comment.id === id ? wrote.comment : comment)),
      error: null,
    }))
  },

  setKeptRanges: (commentId, replyId, keptRanges) => {
    const before = get().comments
    const comment = before.find((item) => item.id === commentId)
    if (!comment) return
    if (replyId) {
      const reply = comment.replies.find((item) => item.id === replyId)
      if (!reply || reply.keptRanges === keptRanges) return
    } else if (comment.keptRanges === keptRanges) return
    const after = before.map((item) => {
      if (item.id !== commentId) return item
      if (!replyId) return { ...item, keptRanges }
      return {
        ...item,
        replies: item.replies.map((reply) => (reply.id === replyId ? { ...reply, keptRanges } : reply)),
      }
    })
    pushCommentHistory(before, after)
    set({ comments: after, error: null })
    scheduleKeptWrite(commentId, replyId, keptRanges)
  },

  remove: (id) => {
    const before = get().comments
    if (!before.some((comment) => comment.id === id)) return
    const wrote = window.branchlog.ai.deleteCommentSync(id)
    if (!wrote.ok) {
      set({ error: 'Could not delete that comment.' })
      return
    }
    cancelKeptWrites(new Set([id]))
    const after = before.filter((comment) => comment.id !== id)
    pushCommentHistory(before, after)
    set({ comments: after, error: null })
  },

  sendReply: async (id, text) => {
    if (get().replyingId !== null || text.trim() === '') return false
    const date = get().date
    set({ replyingId: id })
    try {
      flushKeptWrites()
      const result = await window.branchlog.ai.reply({ commentId: id, requestId: crypto.randomUUID(), text })
      if (get().date !== date) return false
      if (result.kind === 'replied') {
        const before = get().comments
        const current = before.find((comment) => comment.id === id)
        if (!current) return false
        const updated = {
          ...current,
          replies: result.comment.replies.map((reply) => current.replies.find((item) => item.id === reply.id) ?? reply),
        }
        const after = before.map((comment) => (comment.id === id ? updated : comment))
        if (result.comment.side === 'right') pushCommentHistory(before, after)
        set({ comments: after, offline: false, error: null })
        return true
      }
      if (result.kind === 'offline') set({ offline: true })
      return false
    } catch (error) {
      console.error(error)
      if (get().date === date) set({ offline: true })
      return false
    } finally {
      if (get().replyingId === id) set({ replyingId: null })
    }
  },

  request: async (taskId, text, x, y) => {
    const date = get().date
    const requestId = crypto.randomUUID()
    latestRequest = requestId
    set({ thinkingTaskId: taskId })
    try {
      const result = await window.branchlog.ai.requestComment({ taskId, requestId, text, x, y })
      if (get().date !== date || latestRequest !== requestId) return
      if (result.kind === 'comment') {
        set((state) => ({
          comments: [...state.comments, result.comment],
          offline: false,
          error: null,
        }))
      } else if (result.kind === 'offline') {
        set({ offline: true })
      }
    } catch (error) {
      console.error(error)
      if (get().date === date && latestRequest === requestId) set({ offline: true })
    } finally {
      if (latestRequest === requestId) {
        latestRequest = ''
        set({ thinkingTaskId: null })
      }
    }
  },
}))

setCommentRestorer((comments) => {
  useAiComments.getState().replace(comments)
})

setHistoryPrepare(() => {
  flushKeptWrites()
})

setCommentRemovalHandler((removed, direction) => {
  if (direction === 'undo') useAiComments.getState().revive(removed.comments)
  else useAiComments.getState().forgetTasks(new Set(removed.tasks.map((task) => task.id)))
})