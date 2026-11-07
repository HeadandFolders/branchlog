export type TaskSide = 'main' | 'right'

export interface Task {
  id: string
  text: string
  done: boolean
  dateCreated: string
  dateCompleted: string | null
  parentId: string | null
  x: number
  y: number
  side: TaskSide
  orderIndex: number
}

export interface CreateTaskInput {
  id: string
  dateCreated: string
  text: string
  afterId: string | null
}

export interface UpdateTaskInput {
  id: string
  text?: string
  done?: boolean
}

export type MenuAction = 'new-task' | 'today' | 'prev-day' | 'next-day'

export type WriteResult =
  | { ok: true; task: Task }
  | { ok: false }

export interface BranchlogApi {
  tasks: {
    listByDate: (date: string) => Promise<Task[]>
    createSync: (input: CreateTaskInput) => WriteResult
    update: (input: UpdateTaskInput) => Promise<Task>
    updateSync: (input: UpdateTaskInput) => WriteResult
    delete: (id: string) => Promise<void>
  }
  onMenuAction: (callback: (action: MenuAction) => void) => () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.done === 'boolean' &&
    typeof value.dateCreated === 'string' &&
    (value.dateCompleted === null || typeof value.dateCompleted === 'string') &&
    (value.parentId === null || typeof value.parentId === 'string') &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    (value.side === 'main' || value.side === 'right') &&
    typeof value.orderIndex === 'number'
  )
}

export function isWriteResult(value: unknown): value is WriteResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === false) return true
  return isTask(value.task)
}

export function isTaskList(value: unknown): value is Task[] {
  return Array.isArray(value) && value.every(isTask)
}

export function isMenuAction(value: unknown): value is MenuAction {
  return value === 'new-task' || value === 'today' || value === 'prev-day' || value === 'next-day'
}
