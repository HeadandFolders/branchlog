import { useAiComments } from '../store/ai-comments'
import { useAiSettings } from '../store/ai-settings'
import { useNotebook } from '../store/notebook'
import { createAiTrigger } from './ai-trigger'
import { flowPoint } from './branch-from'
import { AI_COMMENT_GAP, AI_COMMENT_LINE_OFFSET, AI_COMMENT_WIDTH } from './canvas-ai'

function commentSpot(taskId: string): { x: number; y: number } | null {
  const field = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)
  const line = field?.closest('.task-line')
  if (!line) return null
  const rect = line.getBoundingClientRect()
  const point = flowPoint({ x: rect.left, y: rect.top })
  if (!point) return null
  // Level with the bullet, not with the top of the row: a comment reads as a note
  // written against that line, and the arrow between them stays a short straight run.
  return { x: point.x - AI_COMMENT_WIDTH - AI_COMMENT_GAP, y: point.y + AI_COMMENT_LINE_OFFSET }
}

export function installAiTrigger(): () => void {
  useAiSettings.getState().load()
  const trigger = createAiTrigger({
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => window.clearTimeout(handle),
    fire: (taskId, text) => {
      const state = useNotebook.getState()
      const task = state.tasks.find((item) => item.id === taskId)
      if (!state.ready || !task || task.text !== text) return
      if (task.side !== 'main' || task.done || task.droppedAt !== null) return
      const spot = commentSpot(taskId)
      if (!spot) return
      void useAiComments.getState().request(taskId, text, spot.x, spot.y)
    },
  })

  const unsubscribeNotebook = useNotebook.subscribe((state, prev) => {
    if (!state.ready || !prev.ready || state.currentDate !== prev.currentDate) {
      trigger.reset()
      return
    }
    if (state.tasks === prev.tasks) return
    const settings = useAiSettings.getState().settings
    const options = { enabled: settings.enabled, pauseMs: settings.pauseDelayMs }
    const prevById = new Map(prev.tasks.map((task) => [task.id, task]))
    for (const task of state.tasks) {
      const before = prevById.get(task.id)
      if (!before || before.text !== task.text) trigger.textChanged(task, options)
    }
    const nowIds = new Set(state.tasks.map((task) => task.id))
    for (const before of prev.tasks) {
      if (!nowIds.has(before.id)) trigger.cancel(before.id)
    }
  })

  const unsubscribeSettings = useAiSettings.subscribe((state, prev) => {
    if (state.settings === prev.settings) return
    if (!state.settings.enabled) trigger.reset()
    if (
      state.settings.enabled !== prev.settings.enabled ||
      state.settings.baseUrl !== prev.settings.baseUrl
    ) {
      useAiComments.setState({ offline: false })
    }
  })

  return () => {
    unsubscribeNotebook()
    unsubscribeSettings()
    trigger.reset()
  }
}