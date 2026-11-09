import { create } from 'zustand'
import type { AiComment } from '@shared/ai-comments'
import { pushCommentHistory, setCommentRemovalHandler, setCommentRestorer } from './history'

interface AiCommentsState {
  date: string
  comments: AiComment[]
  ready: boolean
  thinkingTaskId: string | null
  replyingId: string | null
  offline: boolean
  error: string | null
  adopt: (date: string, comments: AiComment[]) => void
  move: (id: string, x: number, y: number) => void
  place: (moves: readonly { id: string; x: number; y: number }[]) => void
  forgetTasks: (taskIds: ReadonlySet<string>) => void
  revive: (comments: AiComment[]) => void
  replace: (comments: AiComment[]) => void
  setStatus: (id: string, status: 'open' | 'resolved') => void
  remove: (id: string) => void
  sendReply: (id: string, text: string) => Promise<boolean>
  request: (taskId: string, text: string, x: number, y: number) => Promise<void>
}

let latestRequest = ''

export const useAiComments = create<AiCommentsState>((set, get) => ({
  date: '',
  comments: [],
  ready: false,
  thinkingTaskId: null,
  replyingId: null,
  offline: false,
  error: null,

  adopt: (date, comments) => {
    latestRequest = ''
    set({
      date,
      comments,
      ready: true,
      thinkingTaskId: null,
      replyingId: null,
      offline: false,
      error: null,
    })
  },

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

  remove: (id) => {
    const before = get().comments
    if (!before.some((comment) => comment.id === id)) return
    const wrote = window.branchlog.ai.deleteCommentSync(id)
    if (!wrote.ok) {
      set({ error: 'Could not delete that comment.' })
      return
    }
    const after = before.filter((comment) => comment.id !== id)
    pushCommentHistory(before, after)
    set({ comments: after, error: null })
  },

  sendReply: async (id, text) => {
    if (get().replyingId !== null || text.trim() === '') return false
    const date = get().date
    set({ replyingId: id })
    try {
      const result = await window.branchlog.ai.reply({ commentId: id, requestId: crypto.randomUUID(), text })
      if (get().date !== date) return false
      if (result.kind === 'replied') {
        set((state) => ({
          comments: state.comments.map((comment) => (comment.id === id ? result.comment : comment)),
          offline: false,
          error: null,
        }))
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

setCommentRemovalHandler((removed, direction) => {
  if (direction === 'undo') useAiComments.getState().revive(removed.comments)
  else useAiComments.getState().forgetTasks(new Set(removed.tasks.map((task) => task.id)))
})