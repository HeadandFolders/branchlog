import type { Task } from './types.ts'

export interface TaskLife {
  open: boolean
  done: boolean
  dropped: boolean
  carried: boolean
  superseded: boolean
  live: boolean
}

export function taskLife(
  task: Pick<Task, 'dateCompleted' | 'droppedAt' | 'carriedFromId'>,
  superseded: boolean,
): TaskLife {
  const done = task.dateCompleted !== null
  const dropped = task.droppedAt !== null
  const carried = task.carriedFromId !== null
  return {
    open: !done && !dropped && !superseded,
    done,
    dropped,
    carried,
    superseded,
    live: !superseded,
  }
}
