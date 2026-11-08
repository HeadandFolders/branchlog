import { useLayoutEffect, useRef, type RefObject } from 'react'
import { takeCaret } from './caret'
import { applyFocusRequest, keyIsDown } from './focus-field'
import { useNotebook } from '../store/notebook'

export function useTaskFieldFocus(
  ref: RefObject<HTMLDivElement | null>,
  taskId: string,
  editing: boolean,
): void {
  const clearFocusRequest = useNotebook((state) => state.clearFocusRequest)
  const focusPin = useNotebook((state) => {
    const request = state.focusRequest
    if (request?.id !== taskId) return null
    return request.offset ?? -1
  })
  const historyRev = useNotebook((state) => state.historyRev)
  const seenRev = useRef(historyRev)

  useLayoutEffect(() => {
    if (!editing) {
      if (useNotebook.getState().focusRequest?.id === taskId) clearFocusRequest()
      return
    }
    const element = ref.current
    if (!element) return
    const state = useNotebook.getState()
    const mine = state.focusRequest?.id === taskId
    const force = state.historyRev !== seenRev.current
    if (force) seenRev.current = state.historyRev
    const stored = state.tasks.find((item) => item.id === taskId)?.text
    const textChanged = stored !== undefined && element.textContent !== stored
    if (!mine && document.activeElement === element && focusPin === null && !(force && textChanged)) return
    if (!mine && keyIsDown() && document.activeElement === element && !force) return

    const syncText = (): void => {
      if (stored === undefined || element.textContent === stored) return
      const dom = element.textContent ?? ''
      const typedAhead = !force && dom.length > stored.length
      if (!typedAhead) element.textContent = stored
    }

    if (mine) {
      const applyMine = (): boolean => {
        if (useNotebook.getState().focusRequest?.id !== taskId) return true
        const node = element.closest<HTMLElement>('.react-flow__node')
        if (node && getComputedStyle(node).visibility === 'hidden') return false
        syncText()
        return applyFocusRequest(element, taskId)
      }
      let observer: MutationObserver | null = null
      if (!applyMine()) {
        const node = element.closest<HTMLElement>('.react-flow__node')
        if (node) {
          observer = new MutationObserver(() => {
            if (applyMine()) observer?.disconnect()
          })
          observer.observe(node, { attributes: true, attributeFilter: ['style'] })
        }
      }
      return () => observer?.disconnect()
    }

    const selection = window.getSelection()
    const existing = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
    const keepSelection =
      existing !== null &&
      !existing.collapsed &&
      element.contains(existing.startContainer) &&
      element.contains(existing.endContainer)
    if (!keepSelection) syncText()
    element.focus({ preventScroll: true })
    const node = element.closest<HTMLElement>('.react-flow__node')
    if (document.activeElement !== element && node && getComputedStyle(node).visibility === 'hidden') return
    if (!selection) return
    if (keepSelection && existing) {
      takeCaret(taskId)
      selection.removeAllRanges()
      selection.addRange(existing)
    } else {
      const caret = takeCaret(taskId)
      const point = caret ? document.caretRangeFromPoint(caret.x, caret.y) : null
      if (point && element.contains(point.startContainer)) {
        selection.removeAllRanges()
        selection.addRange(point)
      } else {
        const range = document.createRange()
        range.selectNodeContents(element)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
    if (useNotebook.getState().focusRequest?.id === taskId) clearFocusRequest()
  }, [clearFocusRequest, editing, focusPin, historyRev, ref, taskId])
}
