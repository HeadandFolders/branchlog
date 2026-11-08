import type { DeleteResult, Task } from '@shared/types'
import { stageRemoval } from './removed'

interface FocusRequest {
  id: string
  offset?: number
}

interface DeleteSnapshot {
  tasks: Task[]
  focusedId: string | null
  focusRequest: FocusRequest | null
}

interface DeleteWriter {
  get: () => DeleteSnapshot
  set: (partial: Partial<DeleteSnapshot> & { error?: string | null }) => void
  clearPending: (id: string) => void
}

function neighborFocus(tasks: Task[], id: string, removedIds: Set<string>): FocusRequest | null {
  const main = tasks.filter((task) => task.side === 'main')
  const index = main.findIndex((task) => task.id === id)
  const neighbor =
    [...main].slice(0, index).reverse().find((task) => !removedIds.has(task.id)) ??
    main.slice(index + 1).find((task) => !removedIds.has(task.id)) ??
    null
  return neighbor ? { id: neighbor.id } : null
}

export function removeDeletedTasks(id: string, writer: DeleteWriter): void {
  writer.clearPending(id)
  let result: DeleteResult
  try {
    result = window.branchlog.tasks.deleteSync(id)
  } catch (error) {
    console.error(error)
    writer.set({ error: 'Could not delete that task.' })
    return
  }
  if (!result.ok) {
    writer.set({ error: 'Could not delete that task.' })
    return
  }
  const removedIds = new Set(result.removed.tasks.map((task) => task.id))
  for (const removedId of removedIds) writer.clearPending(removedId)
  const { tasks, focusedId } = writer.get()
  const removed = tasks.find((task) => task.id === id)
  let nextFocused = focusedId
  let focusRequest = writer.get().focusRequest
  if (focusedId && removedIds.has(focusedId)) {
    if (removed?.side === 'main') {
      const next = neighborFocus(tasks, id, removedIds)
      nextFocused = next?.id ?? null
      focusRequest = next
    } else {
      nextFocused = null
      focusRequest = null
    }
  }
  stageRemoval(result.removed)
  writer.set({
    tasks: tasks.filter((task) => !removedIds.has(task.id)),
    focusedId: nextFocused,
    focusRequest,
    error: null,
  })
}
