import { create } from 'zustand'
import { addDays, localDateKey } from '@shared/dates'
import { tempMark, tempMs } from '@shared/temp-timing'
import type { MenuAction, Task } from '@shared/types'
import { removeDeletedTasks } from './delete-task'
import { attachHistory, clearHistory } from './history'
import { cancelPendingSizes, clearPendingSize, flushSizesSync, scheduleSize, shiftPendingSize } from './task-size'

interface FocusRequest {
  id: string
  offset?: number
}

interface NotebookState {
  currentDate: string
  tasks: Task[]
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
  deleteTask: (id: string) => void
  runMenuAction: (action: MenuAction) => void
}

interface PendingText {
  text: string
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
    await window.branchlog.tasks.update({ id, text })
    const current = useNotebook.getState().tasks.find((task) => task.id === id)
    if (current && current.text !== text) {
      window.branchlog.tasks.updateSync({ id, text: current.text })
    }
  } catch (error) {
    console.error(error)
    if (!useNotebook.getState().tasks.some((task) => task.id === id)) return
    if (pending.attempts < 1) {
      pendingText.set(id, {
        text,
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
      ready: false,
      error: null,
      focusedId: null,
      focusRequest: null,
    })
    tempMark('store-cleared', { date })
    try {
      const tasks = await window.branchlog.tasks.listByDate(date)
      if (get().currentDate !== date) return
      set({ tasks, ready: true })
      tempMark('store-filled', { date, rows: tasks.length, ms: tempMs(started) })
    } catch (error) {
      console.error(error)
      if (get().currentDate !== date) return
      set({ tasks: [], ready: true, error: 'Could not open that day.' })
    }
  },

  shiftDate: async (days) => {
    await get().goToDate(addDays(get().currentDate, days))
  },

  goToToday: async () => {
    await get().goToDate(localDateKey())
  },

  createTask: (afterId, text, caretAtStart = false) => {
    const { currentDate, tasks } = get()
    const after = afterId ? tasks.find((task) => task.id === afterId) : undefined
    let result
    try {
      result = window.branchlog.tasks.createSync({
        id: crypto.randomUUID(),
        dateCreated: currentDate,
        text,
        afterId: after ? after.id : null,
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
      focusRequest: { id: task.id, offset: caretAtStart ? 0 : task.text.length },
      error: null,
    }))
    return task.id
  },

  createBranch: (parentId, x, y, text = '', caretAtStart = false) => {
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
      focusRequest: { id: task.id, offset: caretAtStart ? 0 : task.text.length },
      error: null,
    }))
    return task.id
  },

  createFromFocused: () => {
    const { focusedId, tasks } = get()
    const focused = focusedId ? tasks.find((task) => task.id === focusedId) : undefined
    const main = tasks.filter((task) => task.side === 'main')
    const afterId = focused?.side === 'main' ? focused.id : null
    get().createTask(main.length === 0 ? null : afterId, '')
  },

  updateText: (id, text) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, text } : task)),
    }))
    const existing = pendingText.get(id)
    if (existing) clearTimeout(existing.timer)
    pendingText.set(id, {
      text,
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
    for (const [id, pending] of pendingText) {
      clearTimeout(pending.timer)
      try {
        window.branchlog.tasks.updateSync({ id, text: pending.text })
      } catch (error) {
        console.error(error)
      }
    }
    pendingText.clear()
    flushPositionsSync()
    flushSizesSync()
  },

  updatePosition: (id, x, y) => {
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, x, y } : task)),
    }))
    if (shiftPendingSize(id, x, y)) return
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
  },

  toggleDone: async (id) => {
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
    } catch (error) {
      console.error(error)
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...previous } : task)),
        error: 'Could not update that task.',
      }))
    }
  },

  deleteTask: (id) => {
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
