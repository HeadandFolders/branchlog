import { create } from 'zustand'
import { addDays, localDateKey } from '@shared/dates'
import type { MenuAction, Task } from '@shared/types'

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
  setFocusedId: (id: string | null) => void
  focusAt: (id: string, offset?: number) => void
  clearFocusRequest: () => void
  goToDate: (date: string) => Promise<void>
  shiftDate: (days: number) => Promise<void>
  goToToday: () => Promise<void>
  createTask: (afterId: string | null, text: string, caretAtStart?: boolean) => string | null
  createFromFocused: () => void
  updateText: (id: string, text: string) => void
  flushText: (id: string) => Promise<void>
  flushPendingSync: () => void
  toggleDone: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  runMenuAction: (action: MenuAction) => void
}

interface PendingText {
  text: string
  timer: number
  attempts: number
}

const pendingText = new Map<string, PendingText>()

async function persistText(id: string): Promise<void> {
  const pending = pendingText.get(id)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingText.delete(id)
  const text = pending.text
  try {
    await window.branchlog.tasks.update({ id, text })
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

export const useNotebook = create<NotebookState>((set, get) => ({
  currentDate: localDateKey(),
  tasks: [],
  ready: false,
  error: null,
  focusedId: null,
  focusRequest: null,

  setFocusedId: (id) => set({ focusedId: id }),
  focusAt: (id, offset) => set({ focusedId: id, focusRequest: { id, offset } }),
  clearFocusRequest: () => set({ focusRequest: null }),

  goToDate: async (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    const pendingIds = [...pendingText.keys()]
    await Promise.all(pendingIds.map((id) => persistText(id)))
    set({
      currentDate: date,
      tasks: [],
      ready: false,
      error: null,
      focusedId: null,
      focusRequest: null,
    })
    try {
      const tasks = await window.branchlog.tasks.listByDate(date)
      if (get().currentDate !== date) return
      set({ tasks, ready: true })
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
          item.orderIndex >= task.orderIndex ? { ...item, orderIndex: item.orderIndex + 1 } : item,
        ),
        task,
      ].sort((a, b) => a.orderIndex - b.orderIndex),
      focusedId: task.id,
      focusRequest: caretAtStart ? { id: task.id, offset: 0 } : { id: task.id },
      error: null,
    }))
    return task.id
  },

  createFromFocused: () => {
    const { focusedId, tasks } = get()
    const afterId = focusedId && tasks.some((task) => task.id === focusedId) ? focusedId : null
    get().createTask(tasks.length === 0 ? null : afterId, '')
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

  deleteTask: async (id) => {
    const pending = pendingText.get(id)
    if (pending) clearTimeout(pending.timer)
    pendingText.delete(id)
    const { tasks, focusedId } = get()
    const index = tasks.findIndex((task) => task.id === id)
    if (index < 0) return
    const removed = tasks[index]
    if (!removed) return
    const neighbor = tasks[index - 1] ?? tasks[index + 1] ?? null
    const nextFocused = focusedId === id ? (neighbor?.id ?? null) : focusedId
    set({
      tasks: tasks.filter((task) => task.id !== id),
      focusedId: nextFocused,
      focusRequest: focusedId === id && neighbor ? { id: neighbor.id } : get().focusRequest,
    })
    try {
      await window.branchlog.tasks.delete(id)
    } catch (error) {
      console.error(error)
      set((state) => ({
        tasks: [...state.tasks, removed].sort((a, b) => a.orderIndex - b.orderIndex),
        error: 'Could not delete that task.',
      }))
    }
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
