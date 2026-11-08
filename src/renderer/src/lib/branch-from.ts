import { useNotebook } from '../store/notebook'

type FlowPoint = (point: { x: number; y: number }) => { x: number; y: number }

let toFlow: FlowPoint | null = null
let handlingShortcut = false

export function branchShortcutHandling(): boolean {
  return handlingShortcut
}

export function registerFlowPoint(fn: FlowPoint): void {
  toFlow = fn
}

export function flowPoint(point: { x: number; y: number }): { x: number; y: number } | null {
  return toFlow ? toFlow(point) : null
}

export function branchShortcutLabel(): string {
  return /Mac/i.test(navigator.userAgent) ? 'Branch (Option+Enter)' : 'Branch (Alt+Enter)'
}

export function branchFromTask(taskId: string): string | null {
  const flow = toFlow
  if (!flow) return null
  const tasks = useNotebook.getState().tasks
  if (!tasks.some((task) => task.id === taskId)) return null
  const text = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)
  const dot = text?.closest('.task-line')?.querySelector<HTMLElement>('.branch-dot')
  if (!dot) return null
  const rect = dot.getBoundingClientRect()
  const point = flow({ x: rect.right + 36, y: rect.top })
  return useNotebook.getState().createBranch(taskId, point.x, point.y)
}

function shortcutTaskId(): string | null {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return null
  if (active instanceof HTMLElement && active.isContentEditable && !active.matches('[data-task-text]')) return null
  const tasks = useNotebook.getState().tasks
  if (active instanceof HTMLElement && active.matches('[data-task-text]')) {
    const id = active.dataset.taskId
    if (id && tasks.some((task) => task.id === id)) return id
  }
  const selected = document.querySelector<HTMLElement>('.react-flow__node.selected')
  const selectedId = selected?.dataset.id
  if (!selectedId || selectedId === 'main-list') return null
  return tasks.some((task) => task.id === selectedId) ? selectedId : null
}

export function branchFromShortcut(): string | null {
  const id = shortcutTaskId()
  if (!id) return null
  return branchFromTask(id)
}

export function installBranchShortcut(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process') return
    handlingShortcut = false
    if (event.repeat) return
    if (event.key !== 'Enter' || !event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return
    if (!shortcutTaskId()) return
    handlingShortcut = true
    event.preventDefault()
    event.stopPropagation()
    branchFromShortcut()
  }
  const onKeyUp = (): void => {
    handlingShortcut = false
  }
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('keyup', onKeyUp, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('keyup', onKeyUp, true)
  }
}
