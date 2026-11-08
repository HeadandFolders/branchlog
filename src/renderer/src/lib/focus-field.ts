import { placeCaret } from './caret'
import { useNotebook } from '../store/notebook'

let armed: { id: string; offset: number } | null = null
let keyDepth = 0
let watchingKeys = false

function watchKeys(): void {
  if (watchingKeys) return
  watchingKeys = true
  document.addEventListener('keydown', () => {
    keyDepth += 1
  }, true)
  document.addEventListener('keyup', () => {
    keyDepth = Math.max(0, keyDepth - 1)
  }, true)
  document.addEventListener('beforeinput', (event) => {
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
  }, true)
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

function placeIfNeeded(element: HTMLElement, offset: number | undefined): void {
  const selection = window.getSelection()
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) return
  const pinned = offset ?? 0
  if (pinned <= 0) return
  const text = element.textContent ?? ''
  const current = caretOffset(element)
  if (current !== 0) return
  placeCaret(element, text.length > pinned ? text.length : pinned)
}

// React Flow's measurement commit drops a caret that was placed while the node
// was still hidden. `finish` is that measurement. A selection change during
// keydown drops the typed character, so the repair waits until the key is up.
export function settleFocusRequest(finish: boolean): boolean {
  watchKeys()
  if (keyDepth > 0) return false
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
  if (request) {
    const stored = state.tasks.find((item) => item.id === id)?.text
    const dom = element.textContent ?? ''
    if (stored !== undefined && dom.length < stored.length) element.textContent = stored
  }
  if (document.activeElement !== element) element.focus({ preventScroll: true })
  if (document.activeElement !== element) return false
  placeIfNeeded(element, request?.offset ?? armed?.offset)
  if (!finish) return false
  if (useNotebook.getState().focusRequest?.id === id) useNotebook.getState().clearFocusRequest()
  armed = null
  return true
}
