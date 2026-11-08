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
  width: number
  height: number
  side: TaskSide
  orderIndex: number
}

export interface CreateTaskInput {
  id: string
  dateCreated: string
  text: string
  afterId: string | null
}

export interface CreateBranchInput {
  id: string
  parentId: string
  text: string
  x: number
  y: number
}

export interface UpdateTaskInput {
  id: string
  text?: string
  done?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}

export type MenuAction =
  | 'new-task'
  | 'today'
  | 'prev-day'
  | 'next-day'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'select-all'

export interface MapPosition {
  taskId: string
  x: number
  y: number
}

export interface RemovedTasks {
  tasks: Task[]
  mapPositions: MapPosition[]
}

export type Ack = { ok: true } | { ok: false }

export type WriteResult =
  | { ok: true; task: Task }
  | { ok: false }

export type DeleteResult = { ok: true; removed: RemovedTasks } | { ok: false }

export interface BranchlogApi {
  tasks: {
    listByDate: (date: string) => Promise<Task[]>
    createSync: (input: CreateTaskInput) => WriteResult
    createBranchSync: (input: CreateBranchInput) => WriteResult
    update: (input: UpdateTaskInput) => Promise<Task>
    updateSync: (input: UpdateTaskInput) => WriteResult
    replaceDaySync: (date: string, tasks: Task[]) => Ack
    deleteSync: (id: string) => DeleteResult
    restoreSync: (removed: RemovedTasks) => Ack
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
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
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

export function isMapPosition(value: unknown): value is MapPosition {
  if (!isRecord(value)) return false
  return typeof value.taskId === 'string' && typeof value.x === 'number' && typeof value.y === 'number'
}

export function isRemovedTasks(value: unknown): value is RemovedTasks {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !Array.isArray(value.mapPositions)) return false
  return value.tasks.every(isTask) && value.mapPositions.every(isMapPosition)
}

export function isDeleteResult(value: unknown): value is DeleteResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === false) return true
  return isRemovedTasks(value.removed)
}

export function isAck(value: unknown): value is Ack {
  return isRecord(value) && (value.ok === true || value.ok === false)
}

export function isMenuAction(value: unknown): value is MenuAction {
  return (
    value === 'new-task' ||
    value === 'today' ||
    value === 'prev-day' ||
    value === 'next-day' ||
    value === 'undo' ||
    value === 'redo' ||
    value === 'cut' ||
    value === 'copy' ||
    value === 'select-all'
  )
}
