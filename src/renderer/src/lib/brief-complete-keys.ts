import { caretOffsets } from './caret'
import { acceptComplete, closeComplete, completeIsOpen, moveComplete, openComplete } from '../store/brief-complete'

interface Field {
  element: HTMLElement
  taskId: string
}

function taskField(target: EventTarget | null): Field | null {
  if (!(target instanceof HTMLElement)) return null
  const element = target.closest<HTMLElement>('[data-task-text]')
  const taskId = element?.dataset.taskId
  if (!element || !taskId) return null
  return { element, taskId }
}

// Reading the query happens on the input event, not on the keydown that typed the '@', so the
// character is already in the row and nothing here has to guess when the browser will insert it.
function onInput(event: Event): void {
  const field = taskField(event.target)
  if (!field) return
  const { start, end } = caretOffsets(field.element)
  if (start !== end) {
    closeComplete()
    return
  }
  openComplete(field, start)
}

// Opening the list never touches the caret and never focuses anything: the row keeps the caret it had,
// and only choosing a candidate writes into the row. Capture phase, so the row's own Enter and
// Escape handling never runs while a choice is waiting.
function onKeyDown(event: KeyboardEvent): void {
  if (!completeIsOpen()) return
  if (!taskField(event.target)) {
    closeComplete()
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    moveComplete(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    moveComplete(-1)
    return
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    acceptComplete()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeComplete()
  }
}

function onBlur(event: FocusEvent): void {
  if (taskField(event.target)) closeComplete()
}

// Bubble phase, so a click on the list itself — which stops the event — never reaches this.
function onPointerDown(): void {
  if (completeIsOpen()) closeComplete()
}

export function installBriefComplete(): () => void {
  document.addEventListener('input', onInput, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('blur', onBlur, true)
  return () => {
    document.removeEventListener('input', onInput, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('blur', onBlur, true)
    closeComplete()
  }
}
