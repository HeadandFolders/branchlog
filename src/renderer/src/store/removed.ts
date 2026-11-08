import type { RemovedTasks } from '@shared/types'

let staged: RemovedTasks | null = null

export function stageRemoval(removed: RemovedTasks): void {
  staged = removed
}

export function takeRemoval(): RemovedTasks | null {
  const value = staged
  staged = null
  return value
}

export function applyRemoval(direction: 'undo' | 'redo', removed: RemovedTasks): boolean {
  try {
    if (direction === 'undo') return window.branchlog.tasks.restoreSync(removed).ok
    const ids = new Set(removed.tasks.map((task) => task.id))
    const roots = removed.tasks.filter((task) => task.parentId === null || !ids.has(task.parentId))
    for (const root of roots) {
      if (!window.branchlog.tasks.deleteSync(root.id).ok) return false
    }
    return roots.length > 0
  } catch (error) {
    console.error(error)
    return false
  }
}
