import type { RemovedTasks } from '@shared/types'

export interface StagedRemoval {
  removed: RemovedTasks
  willCarry: boolean
}

let staged: StagedRemoval | null = null

export function stageRemoval(removed: RemovedTasks, willCarry: boolean): void {
  staged = { removed, willCarry }
}

export function takeRemoval(): StagedRemoval | null {
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
