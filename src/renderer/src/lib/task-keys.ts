import type { KeyboardEvent, MutableRefObject, FormEvent } from 'react'
import type { Task } from '@shared/types'
import { branchShortcutHandling } from './branch-from'
import { caretOffset } from './caret'
import { useNotebook } from '../store/notebook'

function mainTasks(): Task[] {
  return useNotebook.getState().tasks.filter((task) => task.side === 'main')
}

function lineBox(element: HTMLElement): 'only' | 'first' | 'last' | 'middle' {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return 'middle'
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.height === 0) return 'only'
  const box = element.getBoundingClientRect()
  const parsed = Number.parseFloat(getComputedStyle(element).lineHeight)
  const line = Number.isFinite(parsed) && parsed > 0 ? parsed : rect.height
  const onFirst = rect.top <= box.top + line * 0.45
  const onLast = rect.bottom >= box.bottom - line * 0.45
  if (onFirst && onLast) return 'only'
  if (onFirst) return 'first'
  if (onLast) return 'last'
  return 'middle'
}

function caretClientX(element: HTMLElement): number {
  const selection = window.getSelection()
  const box = element.getBoundingClientRect()
  if (!selection || selection.rangeCount === 0) return box.left
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.height === 0) return box.left
  return rect.left
}

function offsetAtColumn(element: HTMLElement, x: number, edge: 'first' | 'last'): number {
  const box = element.getBoundingClientRect()
  const parsed = Number.parseFloat(getComputedStyle(element).lineHeight)
  const line = Number.isFinite(parsed) && parsed > 0 ? parsed : box.height || 24
  const y =
    edge === 'first'
      ? Math.min(box.bottom - 1, box.top + line / 2)
      : Math.max(box.top + 1, box.bottom - line / 2)
  const clamped = Math.min(Math.max(x, box.left + 1), Math.max(box.left + 1, box.right - 1))
  const point = document.caretRangeFromPoint(clamped, y)
  if (!point || !element.contains(point.startContainer)) {
    return edge === 'first' ? 0 : (element.textContent?.length ?? 0)
  }
  try {
    return caretOffset(element, point.startContainer, point.startOffset)
  } catch {
    return edge === 'first' ? 0 : (element.textContent?.length ?? 0)
  }
}

function moveBetweenTasks(element: HTMLElement, task: Task, key: 'ArrowUp' | 'ArrowDown'): boolean {
  if (task.side !== 'main') return false
  const edge = lineBox(element)
  const upward = key === 'ArrowUp'
  if (!upward && edge !== 'last' && edge !== 'only') return false
  if (upward && edge !== 'first' && edge !== 'only') return false
  const tasks = mainTasks()
  const index = tasks.findIndex((item) => item.id === task.id)
  const next = tasks[upward ? index - 1 : index + 1]
  if (!next) return false
  const destination = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(next.id)}"]`)
  if (!destination) return false
  const offset = offsetAtColumn(destination, caretClientX(element), upward ? 'last' : 'first')
  useNotebook.getState().focusAt(next.id, offset)
  return true
}

export function handleTaskBeforeInput(
  event: FormEvent<HTMLDivElement>,
  splitLock: MutableRefObject<boolean>,
  split: (element: HTMLDivElement) => void,
): void {
  const native = event.nativeEvent
  if (!(native instanceof InputEvent) || native.isComposing) return
  if (branchShortcutHandling()) {
    event.preventDefault()
    return
  }
  if (native.inputType !== 'insertParagraph' && native.inputType !== 'insertLineBreak') return
  if (!splitLock.current && native.inputType === 'insertLineBreak') return
  event.preventDefault()
  if (splitLock.current) return
  split(event.currentTarget)
}

export function handleTaskKey(
  event: KeyboardEvent<HTMLDivElement>,
  task: Task,
  splitLock: MutableRefObject<boolean>,
  split: (element: HTMLDivElement) => void,
): void {
  event.stopPropagation()
  if (event.nativeEvent.isComposing || event.key === 'Process') return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.currentTarget.blur()
    useNotebook.getState().setFocusedId(null)
    return
  }
  if (
    (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    moveBetweenTasks(event.currentTarget, task, event.key)
  ) {
    event.preventDefault()
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    splitLock.current = true
    split(event.currentTarget)
    queueMicrotask(() => {
      splitLock.current = false
    })
    return
  }
  const selection = window.getSelection()
  if (
    event.key === 'Backspace' &&
    (event.currentTarget.textContent ?? '') === '' &&
    selection?.isCollapsed !== false &&
    !event.repeat &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault()
    void useNotebook.getState().deleteTask(task.id)
  }
}
