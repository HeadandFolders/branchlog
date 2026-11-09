import type { Task } from '@shared/types'

interface PendingSize {
  x: number
  y: number
  width: number
  height: number
  timer: number
}

interface SavedSize {
  x: number
  y: number
  width: number
  height: number
}

const pendingSize = new Map<string, PendingSize>()

export function updateSizedTaskText(
  task: Task,
  text: string,
  read: () => SavedSize | undefined,
  fail: (message: string) => void,
): Task {
  const height = task.side === 'right' && text.length < task.text.length ? 0 : task.height
  if (height !== task.height) {
    scheduleSize(task.id, task.x, task.y, task.width, height, read, fail)
  }
  return { ...task, text, height }
}

export function shiftPendingSize(id: string, x: number, y: number): boolean {
  const pending = pendingSize.get(id)
  if (!pending) return false
  pending.x = x
  pending.y = y
  return true
}

export function clearPendingSize(id: string): void {
  const pending = pendingSize.get(id)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingSize.delete(id)
}

export function cancelPendingSizes(): void {
  for (const pending of pendingSize.values()) clearTimeout(pending.timer)
  pendingSize.clear()
}

export function flushSizesSync(): void {
  for (const [id, pending] of pendingSize) {
    clearTimeout(pending.timer)
    try {
      window.branchlog.tasks.updateSync({
        id,
        x: pending.x,
        y: pending.y,
        width: pending.width,
        height: pending.height,
      })
    } catch (error) {
      console.error(error)
    }
  }
  pendingSize.clear()
}

export function scheduleSize(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  read: () => SavedSize | undefined,
  fail: (message: string) => void,
): void {
  const existing = pendingSize.get(id)
  if (existing) clearTimeout(existing.timer)
  pendingSize.set(id, {
    x,
    y,
    width,
    height,
    timer: window.setTimeout(() => {
      const pending = pendingSize.get(id)
      if (!pending) return
      pendingSize.delete(id)
      const saved = { x: pending.x, y: pending.y, width: pending.width, height: pending.height }
      void window.branchlog.tasks
        .update({ id, ...saved })
        .then(() => {
          const current = read()
          if (!current) return
          if (
            current.x !== saved.x ||
            current.y !== saved.y ||
            current.width !== saved.width ||
            current.height !== saved.height
          ) {
            window.branchlog.tasks.updateSync({ id, ...current })
          }
        })
        .catch((error: unknown) => {
          console.error(error)
          fail('Could not save that size.')
        })
    }, 200),
  })
}
