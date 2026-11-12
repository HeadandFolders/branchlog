import { create } from 'zustand'
import { addDays, localDateKey } from '@shared/dates'
import { tempMark, tempMs } from '@shared/temp-timing'
import type { Continuation, MenuAction, Task, TaskChainState } from '@shared/types'
import { useAiComments } from './ai-comments'
import { attachChainStates, refreshChainStates } from './chain-states'
import { projectRefForText, refreshBriefs } from './briefs'
import { removeDeletedTasks } from './delete-task'
import { flushDayNote } from './day-note'
import { attachHistory, clearHistory } from './history'
import { layoutAfterWrite, layoutBeforeWrite, prepareHistoryStep } from './layout-bridge'
import { cancelPendingSizes, clearPendingSize, flushSizesSync, scheduleSize, shiftPendingSize, updateSizedTaskText } from './task-size'

interface FocusRequest {
  id: string
  offset?: number
  // A row that did not exist a moment ago. The reveal takes these to the writing
  // line instead of only pulling them inside the screen; a focus that re-reads a
  // row the day already had (a day opening, undo, a jump from the map) just fits.
  anchor?: boolean
}

interface NotebookState {
  currentDate: string
  tasks: Task[]
  continuations: Record<string, Continuation>
  chainStates: Record<string, TaskChainState>
  ready: boolean
  error: string | null
  focusedId: string | null
  focusRequest: FocusRequest | null
  historyRev: number
  setFocusedId: (id: string | null) => void
  focusAt: (id: string, offset?: number) => void
  clearFocusRequest: () => void
  goToDate: (date: string) => Promise<void>
  shiftDate: (days: number) => Promise<void>
  goToToday: () => Promise<void>
  createTask: (afterId: string | null, text: string, caretAtStart?: boolean) => string | null
  createBranch: (parentId: string, x: number, y: number, text?: string, caretAtStart?: boolean) => string | null
  createFromFocused: () => void
  updateText: (id: string, text: string) => void
  updatePosition: (id: string, x: number, y: number) => void
  updateSize: (id: string, x: number, y: number, width: number, height: number) => void
  flushText: (id: string) => Promise<void>
  flushPendingSync: () => void
  toggleDone: (id: string) => Promise<void>
  setDropped: (id: string, dropped: boolean) => Promise<void>
  dismissHold: (id: string) => Promise<void>
  deleteTask: (id: string) => void
  runMenuAction: (action: MenuAction) => void
}

interface PendingText {
  text: string
  projectId: string | null
  timer: number
  attempts: number
}

const pendingText = new Map<string, PendingText>()

interface PendingPosition {
  x: number
  y: number
  timer: number
}

const pendingPosition = new Map<string, PendingPosition>()

function byListOrder(a: Task, b: Task): number {
  if (a.side !== b.side) return a.side === 'main' ? -1 : 1
  return a.orderIndex - b.orderIndex
}

function flushPositionsSync(): void {
  for (const [id, pending] of pendingPosition) {
    clearTimeout(pending.timer)
    try {
      window.branchlog.tasks.updateSync({ id, x: pending.x, y: pending.y })
    } catch (error) {
      console.error(error)
    }
  }
  pendingPosition.clear()
}

async function persistText(id: string): Promise<void> {
  const pending = pendingText.get(id)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingText.delete(id)
  const text = pending.text
  try {
    await window.branchlog.tasks.update({ id, text, projectId: pending.projectId })
    const current = useNotebook.getState().tasks.find((task) => task.id === id)
    if (current && current.text !== text) {
      window.branchlog.tasks.updateSync({
        id,
        text: current.text,
        projectId: current.projectId,
      })
    }
  } catch (error) {
    console.error(error)
    if (!useNotebook.getState().tasks.some((task) => task.id === id)) return
    if (pending.attempts < 1) {
      pendingText.set(id, {
        text,
        projectId: pending.projectId,
        attempts: pending.attempts + 1,
        timer: window.setTimeout(() => {
          void persistText(id)
        }, 800),
      })
      return
    }
    useNotebook.setState({ error: 'Could not save a task. Try again in a moment.' })
  }
}

function commitDay(tasks: Task[]): boolean {
  for (const pending of pendingText.values()) clearTimeout(pending.timer)
  pendingText.clear()
  for (const pending of pendingPosition.values()) clearTimeout(pending.timer)
  pendingPosition.clear()
  cancelPendingSizes()
  try {
    return window.branchlog.tasks.replaceDaySync(useNotebook.getState().currentDate, tasks).ok
  } catch (error) {
    console.error(error)
    return false
  }
}

export const useNotebook = create<NotebookState>((set, get) => ({
  currentDate: localDateKey(),
  tasks: [],
  continuations: {},
  chainStates: {},
  ready: false,
  error: null,
  focusedId: null,
  focusRequest: null,
  historyRev: 0,

  setFocusedId: (id) => set({ focusedId: id }),
  focusAt: (id, offset) => set({ focusedId: id, focusRequest: { id, offset } }),
  clearFocusRequest: () => set({ focusRequest: null }),

  goToDate: async (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    void refreshBriefs()
    layoutBeforeWrite('')
    const started = performance.now()
    clearHistory()
    const pendingIds = [...pendingText.keys()]
    await Promise.all(pendingIds.map((id) => persistText(id)))
    flushPositionsSync()
    flushSizesSync()
    tempMark('goto-flushed', { pendingText: pendingIds.length, ms: tempMs(started) })
    set({
      currentDate: date,
      tasks: [],
      continuations: {},
      chainStates: {},
      ready: false,
      error: null,
      focusedId: null,
      focusRequest: null,
    })
    useAiComments.getState().adopt(date, [])
    tempMark('store-cleared', { date })
    try {
      const day = await window.branchlog.tasks.listByDate(date)
      if (get().currentDate !== date) return
      const tasks = day.tasks
      const marks = await window.branchlog.tasks.continuations(date)
      if (get().currentDate !== date) return
      const continuations: Record<string, Continuation> = {}
      for (const mark of marks) continuations[mark.taskId] = mark
      set({ tasks, continuations, ready: true })
      useAiComments.getState().adopt(date, day.comments)
      tempMark('store-filled', { date, rows: tasks.length, ms: tempMs(started) })
    } catch (error) {
      console.error(error)
      if (get().currentDate !== date) return
      set({ tasks: [], continuations: {}, ready: true, error: 'Could not open that day.' })
      useAiComments.getState().adopt(date, [])
    }
  },

  shiftDate: async (days) => {
    await get().goToDate(addDays(get().currentDate, days))
  },

  goToToday: async () => {
    await get().goToDate(localDateKey())
  },

  createTask: (afterId, text, caretAtStart = false) => {
    layoutBeforeWrite('')
    const { currentDate, tasks } = get()
    const after = afterId ? tasks.find((task) => task.id === afterId) : undefined
    let result
    try {
      result = window.branchlog.tasks.createSync({
        id: crypto.randomUUID(),
        dateCreated: currentDate,
        text,
        afterId: after ? after.id : null,
        projectId: projectRefForText(text),
      })
    } catch (error) {
      console.error(error)
      set({ error: 'Could not add a task.' })
      return null
    }
    if (!result.ok) {
      set({ error: 'Could not add a task.' })
      return null
    }
    const task = result.task
    set((state) => ({
      tasks: [
        ...state.tasks.map((item) =>
          item.side === 'main' && item.orderIndex >= task.orderIndex
            ? { ...item, orderIndex: item.orderIndex + 1 }
            : item,
        ),
        task,
      ].sort(byListOrder),
      focusedId: task.id,
      focusRequest: { id: task.id, offset: caretAtStart ? 0 : task.text.length, anchor: true },
      error: null,
    }))
    return task.id
  },

  createBranch: (parentId, x, y, text = '', caretAtStart = false) => {
    layoutBeforeWrite('')
    const parent = get().tasks.find((task) => task.id === parentId)
    if (!parent) {
      set({ error: 'Could not branch from that task.' })
      return null
    }
    let result
    try {
      result = window.branchlog.tasks.createBranchSync({
        id: crypto.randomUUID(),
        parentId,
        text,
        x,
        y,
        projectId: projectRefForText(text),
      })
    } catch (error) {
      console.error(error)
      set({ error: 'Could not branch from that task.' })
      return null
    }
    if (!result.ok) {
      set({ error: 'Could not branch from that task.' })
      return null
    }
    const task = result.task
    if (task.dateCreated !== get().currentDate) return task.id
    set((state) => ({
      tasks: [...state.tasks, task].sort(byListOrder),
      focusedId: task.id,
      focusRequest: { id: task.id, offset: caretAtStart ? 0 : task.text.length, anchor: true },
      error: null,
    }))
    return task.id
  },

  createFromFocused: () => {
    const { focusedId, tasks } = get()
    const anchor = tasks.find((task) => task.id === focusedId && task.side === 'main')
    get().createTask(anchor?.id ?? null, '')
  },

  updateText: (id, text) => {
    layoutBeforeWrite('')
    const projectId = projectRefForText(text)
    set((state) => ({
      tasks: state.tasks.map((task) => task.id === id
        ? {
            ...updateSizedTaskText(task, text, () => get().tasks.find((item) => item.id === id),
              (message) => set({ error: message })),
            projectId,
          }
        : task),
    }))
    const existing = pendingText.get(id)
    if (existing) clearTimeout(existing.timer)
    pendingText.set(id, {
      text,
      projectId,
      attempts: 0,
      timer: window.setTimeout(() => {
        void persistText(id)
      }, 200),
    })
  },

  flushText: async (id) => {
    await persistText(id)
  },

  flushPendingSync: () => {
    prepareHistoryStep()
    for (const [id, pending] of pendingText) {
      clearTimeout(pending.timer)
      try {
        window.branchlog.tasks.updateSync({ id, text: pending.text, projectId: pending.projectId })
      } catch (error) {
        console.error(error)
      }
    }
    pendingText.clear()
    flushDayNote()
    flushPositionsSync()
    flushSizesSync()
  },

  updatePosition: (id, x, y) => {
    const phase = layoutBeforeWrite(id)
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, x, y } : task)),
    }))
    if (shiftPendingSize(id, x, y)) {
      if (phase === 'defer') layoutAfterWrite()
      return
    }
    if (phase === 'defer') {
      layoutAfterWrite()
      return
    }
    const existing = pendingPosition.get(id)
    if (existing) clearTimeout(existing.timer)
    pendingPosition.set(id, {
      x,
      y,
      timer: window.setTimeout(() => {
        const pending = pendingPosition.get(id)
        if (!pending) return
        pendingPosition.delete(id)
        const x = pending.x
        const y = pending.y
        void window.branchlog.tasks
          .update({ id, x, y })
          .then(() => {
            const current = useNotebook.getState().tasks.find((task) => task.id === id)
            if (!current) return
            if (current.x !== x || current.y !== y) {
              window.branchlog.tasks.updateSync({ id, x: current.x, y: current.y })
            }
          })
          .catch((error: unknown) => {
          console.error(error)
          useNotebook.setState({ error: 'Could not save that position.' })
        })
      }, 200),
    })
  },

  updateSize: (id, x, y, width, height) => {
    const phase = layoutBeforeWrite(id)
    const placed = pendingPosition.get(id)
    if (placed) {
      clearTimeout(placed.timer)
      pendingPosition.delete(id)
    }
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, x, y, width, height } : task)),
    }))
    scheduleSize(
      id,
      x,
      y,
      width,
      height,
      () => {
        const task = useNotebook.getState().tasks.find((item) => item.id === id)
        return task ? { x: task.x, y: task.y, width: task.width, height: task.height } : undefined
      },
      (message) => useNotebook.setState({ error: message }),
    )
    if (phase === 'defer') layoutAfterWrite()
  },

  toggleDone: async (id) => {
    layoutBeforeWrite('')
    const current = get().tasks.find((task) => task.id === id)
    if (!current) return
    const done = !current.done
    const previous = { done: current.done, dateCompleted: current.dateCompleted }
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? { ...task, done, dateCompleted: done ? localDateKey() : null }
          : task,
      ),
      error: null,
    }))
    try {
      const updated = await window.branchlog.tasks.update({ id, done })
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === id
            ? { ...task, done: updated.done, dateCompleted: updated.dateCompleted }
            : task,
        ),
      }))
      refreshChainStates(true)
    } catch (error) {
      console.error(error)
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...previous } : task)),
        error: 'Could not update that task.',
      }))
    }
  },

  setDropped: async (id, dropped) => {
    layoutBeforeWrite('')
    const current = get().tasks.find((task) => task.id === id)
    if (!current) return
    const previous = current.droppedAt
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, droppedAt: dropped ? localDateKey() : null } : task,
      ),
      error: null,
    }))
    try {
      const updated = await window.branchlog.tasks.setDropped({ id, dropped })
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? { ...task, droppedAt: updated.droppedAt } : task)),
      }))
      refreshChainStates(true)
    } catch (error) {
      console.error(error)
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? { ...task, droppedAt: previous } : task)),
        error: 'Could not update that task.',
      }))
    }
  },

  // "Not this row again" is a fact about the row, so it is written on the row. It is the one field a
  // person sets from the margin without editing the task, so nothing else rides along with it.
  dismissHold: async (id) => {
    const current = get().tasks.find((task) => task.id === id)
    if (!current || current.projectHoldDismissed) return
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, projectHoldDismissed: true } : task)),
      error: null,
    }))
    try {
      await window.branchlog.tasks.update({ id, projectHoldDismissed: true })
    } catch (error) {
      console.error(error)
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? { ...task, projectHoldDismissed: false } : task)),
        error: 'Could not update that task.',
      }))
    }
  },

  deleteTask: (id) => {
    layoutBeforeWrite('')
    removeDeletedTasks(id, {
      get,
      set,
      clearPending: (taskId) => {
        const pending = pendingText.get(taskId)
        if (pending) clearTimeout(pending.timer)
        pendingText.delete(taskId)
        const placed = pendingPosition.get(taskId)
        if (placed) clearTimeout(placed.timer)
        pendingPosition.delete(taskId)
        clearPendingSize(taskId)
      },
    })
  },

  runMenuAction: (action) => {
    const state = get()
    switch (action) {
      case 'new-task':
        state.createFromFocused()
        break
      case 'today':
        void state.goToToday()
        break
      case 'prev-day':
        void state.shiftDate(-1)
        break
      case 'next-day':
        void state.shiftDate(1)
        break
      default:
        break
    }
  },
}))

attachHistory({
  get: () => useNotebook.getState(),
  set: (partial) => useNotebook.setState(partial),
  subscribe: (listener) => useNotebook.subscribe(listener),
  commit: commitDay,
})

attachChainStates({
  get: () => useNotebook.getState(),
  set: (partial) => useNotebook.setState(partial),
  subscribe: (listener) => useNotebook.subscribe(listener),
})

export function cancelPositionSaves(ids: readonly string[]): void {
  for (const id of ids) {
    const pending = pendingPosition.get(id)
    if (!pending) continue
    clearTimeout(pending.timer)
    pendingPosition.delete(id)
  }
}
