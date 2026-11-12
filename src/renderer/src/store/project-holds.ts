import { create } from 'zustand'
import { MAX_HOLDS_PER_DAY } from '@shared/project-attribution'

interface ProjectHoldsState {
  // The rows this day that stopped short of a model call because no project could be picked for them.
  held: ReadonlySet<string>
  reserve: (taskId: string) => boolean
  release: (taskId: string) => void
  reset: () => void
}

// A hold is a question the app asked and has not had an answer to, so it lives only for the day it was
// asked on: opening another day, or turning the margin off, leaves no half-asked question behind.
export const useProjectHolds = create<ProjectHoldsState>((set, get) => ({
  held: new Set<string>(),

  reserve: (taskId) => {
    const held = get().held
    if (held.has(taskId)) return true
    if (held.size >= MAX_HOLDS_PER_DAY) return false
    const next = new Set(held)
    next.add(taskId)
    set({ held: next })
    return true
  },

  release: (taskId) => {
    const held = get().held
    if (!held.has(taskId)) return
    const next = new Set(held)
    next.delete(taskId)
    set({ held: next })
  },

  reset: () => {
    if (get().held.size === 0) return
    set({ held: new Set() })
  },
}))

// The trigger owns the timers and the spent-text set, and it is built when the app installs it, so the
// answer to a hold is handed back the same way the comment restorer is.
type HoldResolver = (taskId: string, briefId: string | null) => void

let resolver: HoldResolver | null = null

export function setHoldResolver(next: HoldResolver | null): void {
  resolver = next
}

export function resolveHold(taskId: string, briefId: string | null): void {
  if (!resolver) return
  useProjectHolds.getState().release(taskId)
  resolver(taskId, briefId)
}
