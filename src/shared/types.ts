import type {
  AiComment,
  AiCommentDeleteResult,
  AiCommentResult,
  AiCommentWriteResult,
  AiReplyResult,
  AskAiInput,
  CommentReplyInput,
  CommentRequest,
  KeptRangesInput,
  RemovedComments,
} from './ai-comments'
import { isAiComment, isAiCommentList } from './ai-comments'
import type { AiSettings } from './ai-settings'
import type { ThemeDocument } from './theme'

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
  carriedFromId: string | null
  chainId: string
  droppedAt: string | null
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

export interface CreateContinuationInput {
  id: string
  parentId: string
  text: string
}

export interface Continuation {
  taskId: string
  parentId: string
  parentText: string
  parentDate: string
}

export interface EarlierTask {
  id: string
  text: string
  dateCreated: string
  done: boolean
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

export interface ActivityCount {
  date: string
  count: number
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
  | 'branch-task'
  | 'earlier-task'
  | 'theme-lab'
  | 'ai-settings'
  | 'show-calendar'

export interface MapPosition {
  taskId: string
  x: number
  y: number
}

export interface CarryLink {
  id: string
  carriedFromId: string | null
}

export interface CarryRun {
  id: string
  date: string
  tasks: Task[]
}

export interface RemovedTasks {
  tasks: Task[]
  mapPositions: MapPosition[]
  carryLinks: CarryLink[]
  comments: AiComment[]
}

export interface DayLoad {
  tasks: Task[]
  comments: AiComment[]
}

export interface LayoutPoint {
  id: string
  x: number
  y: number
}

export interface LayoutCommit {
  tasks: LayoutPoint[]
  images: LayoutPoint[]
  comments: LayoutPoint[]
}

export interface ImageCrop {
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
}

export interface CanvasImage extends ImageCrop {
  id: string
  dateKey: string
  fileName: string
  x: number
  y: number
  width: number
  height: number
  src: string
}

export interface ImagePasteInput {
  id: string
  dateKey: string
  x: number
  y: number
}

export interface ImageDropInput {
  id: string
  dateKey: string
  x: number
  y: number
  bytes: Uint8Array
}

export interface ImageSizeInput extends ImageCrop {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface ImageDeleteInput {
  ids: string[]
}

export interface ImageRecord extends ImageCrop {
  id: string
  dateKey: string
  fileName: string
  x: number
  y: number
  width: number
  height: number
}

export type Ack = { ok: true } | { ok: false }

export type ThemeWriteResult = { ok: true } | { ok: false; message: string }

export type WriteResult =
  | { ok: true; task: Task }
  | { ok: false }

export type ContinuationWriteResult =
  | { ok: true; task: Task; continuation: Continuation }
  | { ok: false }

export type DeleteResult = { ok: true; removed: RemovedTasks } | { ok: false }

export type ImageResult = { ok: true; image: CanvasImage } | { ok: false }

export type AiConnectionResult = { ok: true; models: string[] } | { ok: false; message: string }

export interface BranchlogApi {
  tasks: {
    listByDate: (date: string) => Promise<DayLoad>
    createSync: (input: CreateTaskInput) => WriteResult
    createBranchSync: (input: CreateBranchInput) => WriteResult
    createContinuationSync: (input: CreateContinuationInput) => ContinuationWriteResult
    continuations: (date: string) => Promise<Continuation[]>
    searchEarlier: (query: string) => Promise<EarlierTask[]>
    update: (input: UpdateTaskInput) => Promise<Task>
    updateSync: (input: UpdateTaskInput) => WriteResult
    replaceDaySync: (date: string, tasks: Task[]) => Ack
    deleteSync: (id: string) => DeleteResult
    restoreSync: (removed: RemovedTasks) => Ack
    activityCounts: () => Promise<ActivityCount[]>
  }
  images: {
    listByDate: (date: string) => Promise<CanvasImage[]>
    paste: (input: ImagePasteInput) => Promise<ImageResult>
    drop: (input: ImageDropInput) => Promise<ImageResult>
    resizeSync: (input: ImageSizeInput) => Ack
    replaceSync: (date: string, images: ImageRecord[]) => Ack
    deleteSync: (input: ImageDeleteInput) => Ack
  }
  settings: {
    autoSeparate: () => boolean
    setAutoSeparate: (on: boolean) => Ack
    swipeToPan: () => boolean
    setSwipeToPan: (on: boolean) => Ack
    theme: () => ThemeDocument
    setTheme: (theme: ThemeDocument) => ThemeWriteResult
  }
  layout: {
    commitSync: (input: LayoutCommit) => Ack
  }
  ai: {
    settings: () => AiSettings
    setSettings: (settings: AiSettings) => ThemeWriteResult
    testConnection: (baseUrl: string) => Promise<AiConnectionResult>
    requestComment: (input: CommentRequest) => Promise<AiCommentResult>
    ask: (input: AskAiInput) => Promise<AiCommentResult>
    cancel: (requestId: string) => void
    reply: (input: CommentReplyInput) => Promise<AiReplyResult>
    setCommentStatusSync: (id: string, status: 'open' | 'resolved') => AiCommentWriteResult
    setKeptRangesSync: (input: KeptRangesInput) => AiCommentWriteResult
    deleteCommentSync: (id: string) => AiCommentDeleteResult
    restoreCommentsSync: (removed: RemovedComments) => Ack
    replaceCommentsSync: (date: string, comments: AiComment[]) => Ack
  }
  onMenuAction: (callback: (action: MenuAction) => void) => () => void
  onResume: (callback: () => void) => () => void
  carry: {
    ready: () => CarryRun[]
    onApplied: (callback: (run: CarryRun) => void) => () => void
  }
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
    typeof value.orderIndex === 'number' &&
    (value.carriedFromId === null || typeof value.carriedFromId === 'string') &&
    typeof value.chainId === 'string' &&
    value.chainId.length > 0 &&
    (value.droppedAt === null || typeof value.droppedAt === 'string')
  )
}

export function isWriteResult(value: unknown): value is WriteResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === false) return true
  return isTask(value.task)
}

export function isContinuation(value: unknown): value is Continuation {
  if (!isRecord(value)) return false
  return (
    typeof value.taskId === 'string' &&
    typeof value.parentId === 'string' &&
    typeof value.parentText === 'string' &&
    typeof value.parentDate === 'string'
  )
}

export function isContinuationList(value: unknown): value is Continuation[] {
  return Array.isArray(value) && value.every(isContinuation)
}

export function isContinuationWriteResult(value: unknown): value is ContinuationWriteResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === false) return true
  return isTask(value.task) && isContinuation(value.continuation)
}

export function isEarlierTask(value: unknown): value is EarlierTask {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.dateCreated === 'string' &&
    typeof value.done === 'boolean'
  )
}

export function isEarlierTaskList(value: unknown): value is EarlierTask[] {
  return Array.isArray(value) && value.every(isEarlierTask)
}

export function isTaskList(value: unknown): value is Task[] {
  return Array.isArray(value) && value.every(isTask)
}

export function isCarryLink(value: unknown): value is CarryLink {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && (value.carriedFromId === null || typeof value.carriedFromId === 'string')
}

export function isCarryRun(value: unknown): value is CarryRun {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.date === 'string' && isTaskList(value.tasks)
}

export function isCarryRunList(value: unknown): value is CarryRun[] {
  return Array.isArray(value) && value.every(isCarryRun)
}

export function isMapPosition(value: unknown): value is MapPosition {
  if (!isRecord(value)) return false
  return typeof value.taskId === 'string' && typeof value.x === 'number' && typeof value.y === 'number'
}

export function isRemovedTasks(value: unknown): value is RemovedTasks {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.mapPositions) ||
    !Array.isArray(value.carryLinks) ||
    !Array.isArray(value.comments)
  ) {
    return false
  }
  return (
    value.tasks.every(isTask) &&
    value.mapPositions.every(isMapPosition) &&
    value.carryLinks.every(isCarryLink) &&
    value.comments.every(isAiComment)
  )
}

export function isDayLoad(value: unknown): value is DayLoad {
  return isRecord(value) && isTaskList(value.tasks) && isAiCommentList(value.comments)
}

export function isDeleteResult(value: unknown): value is DeleteResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === false) return true
  return isRemovedTasks(value.removed)
}

export function isAck(value: unknown): value is Ack {
  return isRecord(value) && (value.ok === true || value.ok === false)
}

export function isCanvasImage(value: unknown): value is CanvasImage {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.dateKey === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.cropLeft === 'number' &&
    typeof value.cropTop === 'number' &&
    typeof value.cropRight === 'number' &&
    typeof value.cropBottom === 'number' &&
    typeof value.src === 'string'
  )
}

export function isCanvasImageList(value: unknown): value is CanvasImage[] {
  return Array.isArray(value) && value.every(isCanvasImage)
}

export function isImageResult(value: unknown): value is ImageResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === false) return true
  return isCanvasImage(value.image)
}

export function isActivityCount(value: unknown): value is ActivityCount {
  if (!isRecord(value)) return false
  return typeof value.date === 'string' && typeof value.count === 'number' && Number.isInteger(value.count)
}

export function isActivityCountList(value: unknown): value is ActivityCount[] {
  return Array.isArray(value) && value.every(isActivityCount)
}

export function isAiConnectionResult(value: unknown): value is AiConnectionResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === true) {
    return Array.isArray(value.models) && value.models.every((model) => typeof model === 'string')
  }
  return typeof value.message === 'string'
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
    value === 'select-all' ||
    value === 'branch-task' ||
    value === 'earlier-task' ||
    value === 'theme-lab' ||
    value === 'ai-settings' ||
    value === 'show-calendar'
  )
}
