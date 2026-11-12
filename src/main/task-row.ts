import type { Task, TaskSide } from '../shared/types.ts'

export interface TaskRow {
  id: string
  text: string
  done: number
  dateCreated: string
  dateCompleted: string | null
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
  side: string
  orderIndex: number
  carriedFromId: string | null
  chainId: string
  droppedAt: string | null
  projectId: string | null
  projectHoldDismissed: number
}

export const TASK_COLUMNS =
  'id, text, done, dateCreated, dateCompleted, parentId, x, y, width, height, side, orderIndex, carriedFromId, chainId, droppedAt, projectId, projectHoldDismissed'

function asSide(value: string): TaskSide {
  if (value === 'main' || value === 'right') return value
  throw new Error('Invalid task')
}

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    text: row.text,
    done: row.done === 1,
    dateCreated: row.dateCreated,
    dateCompleted: row.dateCompleted,
    parentId: row.parentId,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    side: asSide(row.side),
    orderIndex: row.orderIndex,
    carriedFromId: row.carriedFromId,
    chainId: row.chainId,
    droppedAt: row.droppedAt,
    projectId: row.projectId,
    projectHoldDismissed: row.projectHoldDismissed === 1,
  }
}
