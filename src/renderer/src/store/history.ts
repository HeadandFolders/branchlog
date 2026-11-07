import type { Task } from '@shared/types'

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
    a.side === b.side &&
    a.orderIndex === b.orderIndex
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
      left.side === right.side &&
      left.orderIndex === right.orderIndex
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
  if (sameTasks(beforeTasks, afterTasks)) return
  const last = undoStack.at(-1)
  if (last && sameTasks(last.before, afterTasks) && sameTasks(last.after, beforeTasks)) {
    undoStack.pop()
    return
  }
  const textId = singleTextChange(beforeTasks, afterTasks)
  if (last?.open && last.textId && textId === last.textId && BURST.has(inputType) && sameTasks(last.after, beforeTasks)) {
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
  })
  if (undoStack.length > 200) undoStack.shift()
  redoStack.length = 0
}

function restore(tasks: Task[], focus: string | null, from: Task[]): boolean {
  if (!api) return false
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
  if (api.commit(cloneTasks(tasks))) return true
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
  const entry = undoStack.at(-1)
  if (!entry || !restore(entry.before, entry.beforeFocus, entry.after)) return
  entry.open = false
  undoStack.pop()
  redoStack.push(entry)
}

export function redoEditing(): void {
  const entry = redoStack.at(-1)
  if (!entry || !restore(entry.after, entry.afterFocus, entry.before)) return
  entry.open = false
  redoStack.pop()
  undoStack.push(entry)
}

export function clearHistory(): void {
  undoStack.length = 0
  redoStack.length = 0
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

export function attachHistory(next: HistoryApi): void {
  api = next
  next.subscribe((state, prev) => {
    if (applying || depth > 0) return
    if (!prev.ready || !state.ready) return
    if (prev.currentDate !== state.currentDate) return
    pushChange(prev.tasks, prev.focusedId, state.tasks, state.focusedId, takeInput())
  })
}
