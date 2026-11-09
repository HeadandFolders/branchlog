import type { Task, TaskChainState } from '@shared/types'

interface ChainStateSlice {
  currentDate: string
  tasks: Task[]
  chainStates: Record<string, TaskChainState>
  ready: boolean
  error: string | null
}

interface ChainStateApi {
  get: () => ChainStateSlice
  set: (partial: Partial<Pick<ChainStateSlice, 'chainStates' | 'error'>>) => void
  subscribe: (listener: () => void) => () => void
}

let api: ChainStateApi | null = null
let lastKey: string | null = null
let revision = 0

function stateKey(state: Pick<ChainStateSlice, 'currentDate' | 'tasks' | 'ready'>): string {
  if (!state.ready) return ''
  return JSON.stringify([
    state.currentDate,
    state.tasks.map((task) => [task.id, task.chainId, task.dateCreated, task.dateCompleted, task.droppedAt]),
  ])
}

function sameState(
  previous: TaskChainState | undefined,
  next: TaskChainState,
): previous is TaskChainState {
  return (
    previous !== undefined &&
    previous.state === next.state &&
    previous.date === next.date &&
    previous.copyId === next.copyId &&
    previous.copyDate === next.copyDate &&
    previous.carriedFromDay === next.carriedFromDay &&
    previous.carriedDays === next.carriedDays
  )
}

export function refreshChainStates(force = false): void {
  if (!api) return
  const state = api.get()
  const key = stateKey(state)
  if (!force && key === lastKey) return
  lastKey = key
  const request = ++revision
  if (!state.ready || state.tasks.length === 0) {
    if (Object.keys(state.chainStates).length > 0) api.set({ chainStates: {} })
    return
  }
  const ids = state.tasks.map((task) => task.id)
  void window.branchlog.tasks
    .chainStates(ids)
    .then((rows) => {
      if (!api || request !== revision || stateKey(api.get()) !== key) return
      const current = api.get().chainStates
      const chainStates: Record<string, TaskChainState> = {}
      for (const row of rows) {
        const previous = current[row.id]
        chainStates[row.id] = sameState(previous, row) ? previous : row
      }
      api.set({ chainStates })
    })
    .catch((error: unknown) => {
      console.error(error)
      if (!api || request !== revision || stateKey(api.get()) !== key) return
      api.set({ error: 'Could not load task state.' })
    })
}

export function attachChainStates(next: ChainStateApi): () => void {
  api = next
  const unsubscribe = next.subscribe(() => refreshChainStates())
  refreshChainStates(true)
  return unsubscribe
}
