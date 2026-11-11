import type { RemovedTasks, TaskRemoval } from '@shared/types'
import { getDatabase } from './database'
import { removeTask, restoreRemovedOn } from './task-delete'

export function deleteTask(id: string): TaskRemoval {
  return removeTask(getDatabase(), id)
}

export function restoreRemoved(removed: RemovedTasks): void {
  restoreRemovedOn(getDatabase(), removed)
}
