import { splitRequestPrefix } from '@shared/ai-request'
import { appendBriefRef } from '@shared/brief-refs'
import type { ProjectCorrection } from '@shared/project-attribution'
import type { Task } from '@shared/types'
import { useAiComments } from '../store/ai-comments'
import { useAiSettings } from '../store/ai-settings'
import { useAskAi } from '../store/ask-ai'
import { useBriefs } from '../store/briefs'
import { useDayNote } from '../store/day-note'
import { useNotebook } from '../store/notebook'
import { setHoldResolver, useProjectHolds } from '../store/project-holds'
import { createAiTrigger, type TriggerOptions, type TriggerTask } from './ai-trigger'
import { branchFromTask, flowPoint } from './branch-from'
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

function triggerOptions(): TriggerOptions {
  const settings = useAiSettings.getState().settings
  return {
    enabled: settings.enabled,
    pauseMs: settings.pauseDelayMs,
    remarkOnRequests: settings.remarkOnRequests,
    briefs: useBriefs.getState().briefs,
    dayNote: useDayNote.getState().text,
  }
}

// The newest pinned label on this row is the one the person wrote on its chip, and it outranks any
// keyword guess — so the trigger has to know it before it decides to ask at all.
function correctionFor(taskId: string): ProjectCorrection | null {
  let latest: ProjectCorrection | null = null
  let createdAt = ''
  for (const comment of useAiComments.getState().comments) {
    if (comment.taskId !== taskId || !comment.projectPinned) continue
    if (comment.createdAt < createdAt) continue
    createdAt = comment.createdAt
    latest = { projectId: comment.projectId }
  }
  return latest
}

function triggerTask(task: Task): TriggerTask {
  return {
    id: task.id,
    text: task.text,
    side: task.side,
    done: task.done,
    droppedAt: task.droppedAt,
    projectId: task.projectId,
    holdDismissed: task.projectHoldDismissed,
    correction: correctionFor(task.id),
  }
}

function taskLine(node: EventTarget | null): Element | null {
  return node instanceof Element ? node.closest('.task-line') : null
}

function taskIdIn(node: EventTarget | null): string | null {
  if (!(node instanceof Element)) return null
  const id = node.closest<HTMLElement>('[data-task-id]')?.dataset.taskId
  if (!id) return null
  return useNotebook.getState().tasks.some((task) => task.id === id) ? id : null
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
    hold: (taskId) => useProjectHolds.getState().reserve(taskId),
  })

  // Answering a hold is one ask, made now, for the row as it is after the pick. The pause that held
  // the row is spent, and the text the pick changed to has to be spent too, or the same row would be
  // asked a second time on the very next tick.
  const resolveHold = (taskId: string, briefId: string | null): void => {
    const notebook = useNotebook.getState()
    const task = notebook.tasks.find((item) => item.id === taskId)
    if (!task) return
    void (async () => {
      let text = task.text
      if (briefId === null) {
        await notebook.dismissHold(taskId)
      } else {
        const name = useBriefs.getState().briefs.find((brief) => brief.id === briefId)?.name
        if (!name) return
        text = appendBriefRef(task.text, name)
        // A press inside a node never blurs the row it landed on, so a row that is being edited is
        // still the owner of its own text. Handing the row back is what a click-away does, and only
        // then can the written name reach the screen instead of being overwritten by the next keystroke.
        if (useNotebook.getState().focusedId === taskId) notebook.setFocusedId(null)
        notebook.updateText(taskId, text)
      }
      const current = useNotebook.getState().tasks.find((item) => item.id === taskId)
      if (!current || current.text !== text) return
      await notebook.flushText(taskId)
      const spot = commentSpot(taskId)
      if (!spot) return
      trigger.consume(taskId, text)
      await useAiComments.getState().request(taskId, text, spot.x, spot.y)
    })()
  }
  setHoldResolver(resolveHold)

  // A request is spent once per committed text, so a row that loses focus twice is not asked twice.
  const asked = new Set<string>()

  const commitRequest = (taskId: string): boolean => {
    const notebook = useNotebook.getState()
    if (!notebook.ready) return false
    const task = notebook.tasks.find((item) => item.id === taskId)
    if (!task) return false
    const split = splitRequestPrefix(task.text)
    if (!split.isRequest || split.body.trim() === '') return false
    const options = triggerOptions()
    if (!options.enabled) return false
    const key = `${task.id}|${task.text}`
    if (asked.has(key)) return true
    asked.add(key)

    void (async () => {
      // Main reads the day from SQLite, so the row itself has to be written before it is asked about.
      await notebook.flushText(task.id)
      const current = useNotebook.getState().tasks.find((item) => item.id === taskId)
      if (!current || current.text !== task.text) return
      const focusedBefore = useNotebook.getState().focusedId
      // The request is answered in its own branch, so the marker stays on the row and never travels.
      const branchId = task.side === 'right' ? task.id : branchFromTask(task.id, split.body)
      if (!branchId) return
      // createBranch hands focus and the caret to the new row, and a still-queued request would
      // pan the canvas to it. A commit is not an edit, so both are handed back before React renders.
      const after = useNotebook.getState()
      if (after.focusRequest?.id === branchId) after.clearFocusRequest()
      if (after.focusedId === branchId) after.setFocusedId(focusedBefore)
      if (options.remarkOnRequests) trigger.commitRemark(triggerTask(task), options)
      await useAskAi.getState().ask(branchId, true)
    })()
    return true
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process' || event.repeat) return
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey)) return
    const id = taskIdIn(event.target)
    if (!id) return
    // Only a request row takes the key over; Ctrl+Enter stays a line break on every other row.
    if (commitRequest(id)) event.preventDefault()
  }

  const onFocusOut = (event: FocusEvent): void => {
    const line = taskLine(event.target)
    if (!line || line === taskLine(event.relatedTarget)) return
    const id = taskIdIn(event.target)
    if (id) commitRequest(id)
  }

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusout', onFocusOut)

  const unsubscribeNotebook = useNotebook.subscribe((state, prev) => {
    if (!state.ready || !prev.ready || state.currentDate !== prev.currentDate) {
      trigger.reset()
      asked.clear()
      useProjectHolds.getState().reset()
      return
    }
    if (state.tasks === prev.tasks) return
    const options = triggerOptions()
    const prevById = new Map(prev.tasks.map((task) => [task.id, task]))
    for (const task of state.tasks) {
      const before = prevById.get(task.id)
      if (!before || before.text !== task.text) trigger.textChanged(triggerTask(task), options)
    }
    const nowIds = new Set(state.tasks.map((task) => task.id))
    for (const before of prev.tasks) {
      if (!nowIds.has(before.id)) trigger.cancel(before.id)
    }
  })

  const unsubscribeSettings = useAiSettings.subscribe((state, prev) => {
    if (state.settings === prev.settings) return
    if (!state.settings.enabled) {
      trigger.reset()
      asked.clear()
      useProjectHolds.getState().reset()
    }
    if (
      state.settings.enabled !== prev.settings.enabled ||
      state.settings.baseUrl !== prev.settings.baseUrl
    ) {
      useAiComments.setState({ offline: false })
    }
  })

  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('focusout', onFocusOut)
    unsubscribeNotebook()
    unsubscribeSettings()
    setHoldResolver(null)
    useProjectHolds.getState().reset()
    trigger.reset()
  }
}
