import { placeCaret } from './caret'
import { requestReveal } from './reveal-viewport'
import { useNotebook } from '../store/notebook'

let armed: { id: string; offset: number } | null = null
let keyDepth = 0
let heldTyping = false
let watchingKeys = false

function watchKeys(): void {
  if (watchingKeys) return
  watchingKeys = true
  document.addEventListener(
    'keydown',
    (event) => {
      keyDepth += 1
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
        heldTyping = true
      }
    },
    true,
  )
  document.addEventListener(
    'keyup',
    () => {
      keyDepth = Math.max(0, keyDepth - 1)
      if (keyDepth > 0) return
      heldTyping = false
      const request = useNotebook.getState().focusRequest
      if (!request) return
      const element = fieldFor(request.id)
      if (!element) return
      applyFocusRequest(element, request.id)
    },
    true,
  )
  document.addEventListener(
    'beforeinput',
    (event) => {
      if (!(event instanceof InputEvent)) return
      if (event.inputType !== 'insertText' && event.inputType !== 'insertCompositionText') return
      if (!armed || armed.offset <= 0) return
      const element = document.activeElement
      if (!(element instanceof HTMLElement) || element.dataset.taskId !== armed.id) return
      const selection = window.getSelection()
      if (!selection || !selection.isCollapsed) return
      const current = caretOffset(element)
      if (current !== 0) return
      const text = element.textContent ?? ''
      placeCaret(element, text.length > armed.offset ? text.length : armed.offset)
    },
    true,
  )
}

export function armFocusSettle(id: string, offset: number): void {
  watchKeys()
  armed = { id, offset }
}

export function keyIsDown(): boolean {
  return keyDepth > 0
}

export function focusSettlePending(): boolean {
  return useNotebook.getState().focusRequest !== null || armed !== null
}

if (typeof document !== 'undefined') watchKeys()

function caretOffset(element: HTMLElement): number | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer)) return null
  const probe = document.createRange()
  probe.selectNodeContents(element)
  probe.setEnd(range.startContainer, range.startOffset)
  return probe.toString().length
}

function fieldFor(id: string): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
  if (!element) return null
  const node = element.closest<HTMLElement>('.react-flow__node')
  if (node && getComputedStyle(node).visibility === 'hidden') return null
  return element
}

function placeIfNeeded(element: HTMLElement, offset: number): void {
  const selection = window.getSelection()
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) return
  if (offset <= 0) return
  const current = caretOffset(element)
  if (current !== 0) return
  const text = element.textContent ?? ''
  placeCaret(element, text.length > offset ? text.length : offset)
}

// The creation path records `focusRequest`. This applies it once the field can
// hold a caret. A hidden React Flow node cannot; the caller retries when the
// node is shown. The request is cleared only after focus has landed.
// A selection change during a character key drops that character, so a field
// that is already focused waits and lets the beforeinput repair run instead.
export function applyFocusRequest(element: HTMLElement, id: string): boolean {
  watchKeys()
  const state = useNotebook.getState()
  if (state.focusedId !== id) return true
  const request = state.focusRequest
  const pending = request?.id === id
  const repair = !pending && armed?.id === id
  if (!pending && !repair) return true

  const node = element.closest<HTMLElement>('.react-flow__node')
  if (node && getComputedStyle(node).visibility === 'hidden') return false

  const offset = pending && request ? (request.offset ?? 0) : (armed?.offset ?? 0)
  if (pending) {
    const stored = state.tasks.find((task) => task.id === id)?.text
    const dom = element.textContent ?? ''
    if (stored !== undefined && dom.length < stored.length) element.textContent = stored
  }

  const already = document.activeElement === element
  if (already && heldTyping) {
    if (pending) {
      armFocusSettle(id, offset)
      if (useNotebook.getState().focusRequest?.id === id) useNotebook.getState().clearFocusRequest()
      requestReveal(id)
    }
    return true
  }

  if (!already) {
    element.focus({ preventScroll: true })
    if (document.activeElement !== element) return false
  }

  if (pending || !already) placeCaret(element, offset)
  else placeIfNeeded(element, offset)

  if (pending) {
    armFocusSettle(id, offset)
    if (useNotebook.getState().focusRequest?.id === id) useNotebook.getState().clearFocusRequest()
    requestReveal(id)
  }
  return true
}

// React Flow's measurement commit drops a caret that was placed while the node
// was still hidden. `finish` is that measurement. Armed repair stays until the
// key is up so it can fix the next character without moving the selection now.
export function settleFocusRequest(finish: boolean): boolean {
  watchKeys()
  const state = useNotebook.getState()
  const request = state.focusRequest
  const id = request?.id ?? armed?.id
  if (!id) return true
  if (state.focusedId !== id) {
    armed = null
    return true
  }
  const element = fieldFor(id)
  if (!element) return false
  if (!applyFocusRequest(element, id)) return false
  if (!finish || keyDepth > 0) return false
  armed = null
  return true
}
