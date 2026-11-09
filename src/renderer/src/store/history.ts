import type { AiComment } from '@shared/ai-comments'
import type { CanvasImage, RemovedTasks, Task } from '@shared/types'
import { hideDeleteNotice, showDeleteNotice } from './delete-notice'
import { markLayoutRestore, prepareHistoryStep } from './layout-bridge'
import { applyRemoval, takeRemoval } from './removed'

interface FocusRequest {
  id: string
  offset?: number
}

interface HistorySlice {
  tasks: Task[]
  focusedId: string | null
  focusRequest: FocusRequest | null
  historyRev: number
  ready: boolean
  currentDate: string
  error: string | null
}

interface HistoryApi {
  get: () => HistorySlice
  set: (partial: Partial<HistorySlice>) => void
  subscribe: (listener: (state: HistorySlice, prev: HistorySlice) => void) => () => void
  commit: (tasks: Task[]) => boolean
}

interface Entry {
  before: Task[]
  after: Task[]
  beforeFocus: string | null
  afterFocus: string | null
  textId: string | null
  open: boolean
  removed: RemovedTasks | null
  images: { before: CanvasImage[]; after: CanvasImage[] } | null
  comments: { before: AiComment[]; after: AiComment[] } | null
}

const BURST = new Set([
  'insertText',
  'insertCompositionText',
  'insertFromComposition',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
  'deleteSoftLineBackward',
  'deleteSoftLineForward',
  'insertLineBreak',
  'insertReplacementText',
])

const undoStack: Entry[] = []
const redoStack: Entry[] = []
let api: HistoryApi | null = null
let applying = false
let causeStamp = 0
let restoreImages: ((images: CanvasImage[]) => void) | null = null
let restoreComments: ((comments: AiComment[]) => void) | null = null
let commentRemoval: ((removed: RemovedTasks, direction: 'undo' | 'redo') => void) | null = null
let depth = 0
let batchBefore: { tasks: Task[]; focus: string | null } | null = null
let pendingInput = ''

function cloneTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => ({ ...task }))
}

function sameTask(a: Task, b: Task): boolean {
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.done === b.done &&
    a.dateCreated === b.dateCreated &&
    a.dateCompleted === b.dateCompleted &&
    a.parentId === b.parentId &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.side === b.side &&
    a.orderIndex === b.orderIndex &&
    a.carriedFromId === b.carriedFromId &&
    a.chainId === b.chainId &&
    a.droppedAt === b.droppedAt
  )
}

function sameTasks(a: Task[], b: Task[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (!left || !right || !sameTask(left, right)) return false
  }
  return true
}

function singleTextChange(before: Task[], after: Task[]): string | null {
  if (before.length !== after.length) return null
  let changed: string | null = null
  for (let index = 0; index < before.length; index += 1) {
    const left = before[index]
    const right = after[index]
    if (!left || !right || left.id !== right.id) return null
    const textOnly =
      left.done === right.done &&
      left.dateCreated === right.dateCreated &&
      left.dateCompleted === right.dateCompleted &&
      left.parentId === right.parentId &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height &&
      left.side === right.side &&
      left.orderIndex === right.orderIndex &&
      left.carriedFromId === right.carriedFromId &&
      left.chainId === right.chainId &&
      left.droppedAt === right.droppedAt
    if (!textOnly) return null
    if (left.text !== right.text) {
      if (changed) return null
      changed = left.id
    }
  }
  return changed
}

function caretAfterUndo(current: string, restored: string): number {
  let start = 0
  const max = Math.min(current.length, restored.length)
  while (start < max && current.charCodeAt(start) === restored.charCodeAt(start)) start += 1
  if (start === current.length || start === restored.length) return start
  let end = 0
  while (
    end < current.length - start &&
    end < restored.length - start &&
    current.charCodeAt(current.length - 1 - end) === restored.charCodeAt(restored.length - 1 - end)
  ) {
    end += 1
  }
  return restored.length - end
}

function textCaret(from: Task[], to: Task[], focusId: string | null): FocusRequest | null {
  if (!focusId) return null
  const next = to.find((task) => task.id === focusId)
  const prev = from.find((task) => task.id === focusId)
  if (!next) return null
  if (!prev) return { id: focusId, offset: next.text.length }
  if (prev.text === next.text) return null
  return { id: focusId, offset: caretAfterUndo(prev.text, next.text) }
}

export function markInput(inputType: string): void {
  pendingInput = inputType
}

function takeInput(): string {
  const value = pendingInput
  pendingInput = ''
  return value
}

function pushChange(
  beforeTasks: Task[],
  beforeFocus: string | null,
  afterTasks: Task[],
  afterFocus: string | null,
  inputType: string,
): void {
  const removed = takeRemoval()
  if (sameTasks(beforeTasks, afterTasks) && !removed) return
  const last = undoStack.at(-1)
  if (!removed && last && sameTasks(last.before, afterTasks) && sameTasks(last.after, beforeTasks)) {
    undoStack.pop()
    hideDeleteNotice()
    return
  }
  const textId = removed ? null : singleTextChange(beforeTasks, afterTasks)
  if (!removed && last?.open && last.textId && textId === last.textId && BURST.has(inputType) && sameTasks(last.after, beforeTasks)) {
    last.after = cloneTasks(afterTasks)
    last.afterFocus = afterFocus
    if (sameTasks(last.before, last.after)) undoStack.pop()
    return
  }
  undoStack.push({
    before: cloneTasks(beforeTasks),
    after: cloneTasks(afterTasks),
    beforeFocus,
    afterFocus,
    textId,
    open: textId !== null && BURST.has(inputType),
    removed,
    images: null,
    comments: null,
  })
  if (undoStack.length > 200) undoStack.shift()
  redoStack.length = 0
  if (removed) showDeleteNotice(removed.tasks.length)
  else hideDeleteNotice()
}

function restore(
  tasks: Task[],
  focus: string | null,
  from: Task[],
  removed: RemovedTasks | null,
  images: { before: CanvasImage[]; after: CanvasImage[] } | null,
  comments: { before: AiComment[]; after: AiComment[] } | null,
  direction: 'undo' | 'redo',
): boolean {
  if (!api) return false
  markLayoutRestore()
  if (removed && !applyRemoval(direction, removed)) {
    api.set({ error: 'Could not undo that edit.' })
    return false
  }
  const previous = api.get()
  const caret = textCaret(from, tasks, focus)
  applying = true
  api.set({
    tasks: cloneTasks(tasks),
    focusedId: focus,
    focusRequest: caret,
    historyRev: previous.historyRev + 1,
    error: null,
  })
  applying = false
  if (api.commit(cloneTasks(tasks))) {
    if (images) restoreImages?.(direction === 'undo' ? images.before : images.after)
    if (comments) restoreComments?.(direction === 'undo' ? comments.before : comments.after)
    if (removed) commentRemoval?.(removed, direction)
    return true
  }
  if (removed) applyRemoval(direction === 'undo' ? 'redo' : 'undo', removed)
  applying = true
  api.set({
    tasks: cloneTasks(previous.tasks),
    focusedId: previous.focusedId,
    focusRequest: null,
    historyRev: previous.historyRev + 2,
    error: 'Could not undo that edit.',
  })
  applying = false
  return false
}

export function undoEditing(): void {
  prepareHistoryStep()
  const entry = undoStack.at(-1)
  if (!entry || !restore(entry.before, entry.beforeFocus, entry.after, entry.removed, entry.images, entry.comments, 'undo')) return
  entry.open = false
  undoStack.pop()
  redoStack.push(entry)
  if (entry.removed) hideDeleteNotice()
}

export function redoEditing(): void {
  prepareHistoryStep()
  const entry = redoStack.at(-1)
  if (!entry || !restore(entry.after, entry.afterFocus, entry.before, entry.removed, entry.images, entry.comments, 'redo')) return
  entry.open = false
  redoStack.pop()
  undoStack.push(entry)
  if (entry.removed) showDeleteNotice(entry.removed.tasks.length)
}

export function clearHistory(): void {
  undoStack.length = 0
  redoStack.length = 0
  hideDeleteNotice()
}

export function batchEdits(run: () => void): void {
  if (!api) {
    run()
    return
  }
  if (depth === 0) {
    const state = api.get()
    batchBefore = { tasks: cloneTasks(state.tasks), focus: state.focusedId }
  }
  depth += 1
  try {
    run()
  } finally {
    depth -= 1
    if (depth === 0 && batchBefore) {
      const state = api.get()
      pushChange(batchBefore.tasks, batchBefore.focus, state.tasks, state.focusedId, takeInput())
      batchBefore = null
    }
  }
}

export function installHistoryKeys(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process') return
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    if (event.target instanceof Element && event.target.closest('[data-theme-lab]')) return
    if (event.target instanceof HTMLInputElement) return
    const key = event.key.toLowerCase()
    const undo = key === 'z' && !event.shiftKey
    const redo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey)
    if (!undo && !redo) return
    event.preventDefault()
    event.stopPropagation()
    if (undo) undoEditing()
    else redoEditing()
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}

function cloneImages(images: CanvasImage[]): CanvasImage[] {
  return images.map((image) => ({ ...image }))
}

export function setImageRestorer(fn: (images: CanvasImage[]) => void): void {
  restoreImages = fn
}

function cloneComments(comments: AiComment[]): AiComment[] {
  return comments.map((comment) => ({ ...comment, replies: comment.replies.map((reply) => ({ ...reply })) }))
}

export function setCommentRestorer(fn: (comments: AiComment[]) => void): void {
  restoreComments = fn
}

export function setCommentRemovalHandler(fn: (removed: RemovedTasks, direction: 'undo' | 'redo') => void): void {
  commentRemoval = fn
}

export function pushCommentHistory(before: AiComment[], after: AiComment[]): void {
  if (!api) return
  const state = api.get()
  undoStack.push({
    before: cloneTasks(state.tasks),
    after: cloneTasks(state.tasks),
    beforeFocus: state.focusedId,
    afterFocus: state.focusedId,
    textId: null,
    open: false,
    removed: null,
    images: null,
    comments: { before: cloneComments(before), after: cloneComments(after) },
  })
  if (undoStack.length > 200) undoStack.shift()
  redoStack.length = 0
  causeStamp = undoStack.length
}

export function armLayoutHistory(): number {
  causeStamp = undoStack.length
  return causeStamp
}

export function pushImageHistory(before: CanvasImage[], after: CanvasImage[]): void {
  if (!api) return
  const state = api.get()
  undoStack.push({
    before: cloneTasks(state.tasks),
    after: cloneTasks(state.tasks),
    beforeFocus: state.focusedId,
    afterFocus: state.focusedId,
    textId: null,
    open: false,
    removed: null,
    images: { before: cloneImages(before), after: cloneImages(after) },
    comments: null,
  })
  if (undoStack.length > 200) undoStack.shift()
  redoStack.length = 0
  causeStamp = undoStack.length
}

export function foldMovedTasks(moves: readonly { id: string; x: number; y: number }[]): void {
  if (!api || moves.length === 0) return
  const moved = new Map(moves.map((move) => [move.id, move]))
  const state = api.get()
  let changed = false
  const tasks = state.tasks.map((task) => {
    const next = moved.get(task.id)
    if (!next || (task.x === next.x && task.y === next.y)) return task
    changed = true
    return { ...task, x: next.x, y: next.y }
  })
  if (!changed) return
  const before = cloneTasks(state.tasks)
  applying = true
  api.set({ tasks })
  applying = false
  if (causeStamp > 0 && undoStack.length === causeStamp) {
    const last = undoStack[causeStamp - 1]
    if (last) last.after = cloneTasks(tasks)
    return
  }
  undoStack.push({
    before,
    after: cloneTasks(tasks),
    beforeFocus: state.focusedId,
    afterFocus: state.focusedId,
    textId: null,
    open: false,
    removed: null,
    images: null,
    comments: null,
  })
  if (undoStack.length > 200) undoStack.shift()
  redoStack.length = 0
  causeStamp = undoStack.length
}

export function foldMovedImages(moves: readonly { id: string; x: number; y: number }[]): void {
  if (causeStamp <= 0 || undoStack.length !== causeStamp) return
  const last = undoStack[causeStamp - 1]
  if (!last?.images) return
  const moved = new Map(moves.map((move) => [move.id, move]))
  last.images = {
    before: last.images.before,
    after: last.images.after.map((image) => {
      const next = moved.get(image.id)
      return next ? { ...image, x: next.x, y: next.y } : image
    }),
  }
}

export function recordCarry(date: string, created: Task[]): boolean {
  if (!api || created.length === 0) return true
  const state = api.get()
  if (!state.ready || state.currentDate !== date) return false
  const ids = new Set(created.map((task) => task.id))
  const have = new Set(state.tasks.map((task) => task.id))
  const missing = created.filter((task) => !have.has(task.id) && task.dateCreated === date)
  let after = state.tasks
  if (missing.length > 0) {
    after = [...state.tasks, ...missing].sort(compareCarryOrder)
    applying = true
    api.set({ tasks: cloneTasks(after) })
    applying = false
  }
  const before = after.filter((task) => !ids.has(task.id))
  if (sameTasks(before, after)) return true
  undoStack.push({
    before: cloneTasks(before),
    after: cloneTasks(after),
    beforeFocus: state.focusedId,
    afterFocus: state.focusedId,
    textId: null,
    open: false,
    removed: null,
    images: null,
    comments: null,
  })
  if (undoStack.length > 200) undoStack.shift()
  redoStack.length = 0
  hideDeleteNotice()
  return true
}

function compareCarryOrder(a: Task, b: Task): number {
  if (a.side !== b.side) return a.side === 'main' ? -1 : 1
  return a.orderIndex - b.orderIndex
}

export function attachHistory(next: HistoryApi): void {
  api = next
  next.subscribe((state, prev) => {
    if (applying || depth > 0) return
    if (!prev.ready || !state.ready || prev.currentDate !== state.currentDate) {
      takeRemoval()
      return
    }
    pushChange(prev.tasks, prev.focusedId, state.tasks, state.focusedId, takeInput())
  })
}
