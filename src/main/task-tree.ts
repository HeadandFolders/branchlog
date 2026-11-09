import type { RemovedTasks } from '@shared/types'
import { getDatabase } from './database'
import { removeTask, restoreRemovedOn } from './task-delete'

export function deleteTask(id: string): RemovedTasks {
  return removeTask(getDatabase(), id)
}

export function restoreRemoved(removed: RemovedTasks): void {
  restoreRemovedOn(getDatabase(), removed)
}
