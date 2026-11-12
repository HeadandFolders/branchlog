import { create } from 'zustand'
import type { PendingSave } from '@shared/ai-comments'
import { useAiComments } from './ai-comments'
import { useAiSettings } from './ai-settings'
import { pushCommentHistory } from './history'
import { useNotebook } from './notebook'

interface AskAiState {
  taskId: string | null
  requestId: string | null
  messages: Record<string, string>
  // One save offer per answer, kept only for this screen: the file is written when the person
  // clicks Save, so nothing here reaches the database.
  pendingSaves: Record<string, PendingSave>
  ask: (taskId: string, request?: boolean) => Promise<void>
  cancel: () => void
}

export const useAskAi = create<AskAiState>((set, get) => ({
  taskId: null,
  requestId: null,
  messages: {},
  pendingSaves: {},

  cancel: () => {
    const requestId = get().requestId
    if (requestId) window.branchlog.ai.cancel(requestId)
    set({ taskId: null, requestId: null })
  },

  ask: async (taskId, request = false) => {
    const notebook = useNotebook.getState()
    const task = notebook.tasks.find((item) => item.id === taskId)
    if (!notebook.ready || !task || task.side !== 'right' || task.done || task.droppedAt !== null) return
    if (!useAiSettings.getState().settings.enabled || task.text.trim() === '' || useAiComments.getState().replyingId) return
    get().cancel()
    const date = notebook.currentDate
    const requestId = crypto.randomUUID()
    set((state) => ({ taskId, requestId, messages: { ...state.messages, [taskId]: '' } }))
    try {
      await notebook.flushText(taskId)
      if (get().requestId !== requestId) return
      const result = await window.branchlog.ai.ask({
        taskId,
        requestId,
        text: task.text,
        ...(request ? { request: true } : {}),
      })
      if (get().requestId !== requestId || useNotebook.getState().currentDate !== date) return
      if (result.kind === 'comment') {
        const comment = result.comment
        const before = useAiComments.getState().comments
        const after = [...before, comment]
        pushCommentHistory(before, after)
        useAiComments.setState({ comments: after, offline: false, error: null })
        const pendingSave = result.pendingSave
        if (pendingSave) {
          set((state) => ({ pendingSaves: { ...state.pendingSaves, [comment.id]: pendingSave } }))
        }
      } else {
        set((state) => ({
          messages: { ...state.messages, [taskId]: result.kind === 'offline' ? 'LM Studio is offline.' : 'No answer this time.' },
        }))
        if (result.kind === 'offline') useAiComments.setState({ offline: true })
      }
    } catch (error) {
      console.error(error)
      if (get().requestId === requestId) {
        set((state) => ({ messages: { ...state.messages, [taskId]: 'Could not get an answer.' } }))
        useAiComments.setState({ offline: true })
      }
    } finally {
      if (get().requestId === requestId) set({ taskId: null, requestId: null })
    }
  },
}))

export function installAskAiLifecycle(): () => void {
  const removeNotebook = useNotebook.subscribe((state, before) => {
    const pending = useAskAi.getState()
    if (state.currentDate !== before.currentDate || !state.ready) {
      pending.cancel()
      useAskAi.setState({ messages: {}, pendingSaves: {} })
      return
    }
    if (!pending.taskId) return
    const task = state.tasks.find((item) => item.id === pending.taskId)
    if (!task || task.done || task.droppedAt !== null) pending.cancel()
  })
  const removeSettings = useAiSettings.subscribe((state, before) => {
    if (state.settings.enabled !== before.settings.enabled || state.settings.baseUrl !== before.settings.baseUrl || state.settings.model !== before.settings.model) {
      useAskAi.getState().cancel()
      useAskAi.setState({ messages: {}, pendingSaves: {} })
    }
  })
  return () => {
    removeNotebook()
    removeSettings()
    useAskAi.getState().cancel()
    useAskAi.setState({ pendingSaves: {} })
  }
}
