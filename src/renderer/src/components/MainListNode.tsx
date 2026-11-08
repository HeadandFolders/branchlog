import { useEffect, useLayoutEffect, useRef } from 'react'
import { DateHeader } from './DateHeader'
import { TaskBullet } from './TaskBullet'
import { rememberCaret, rangeOffsets } from '../lib/caret'
import { handleNewTaskKey } from '../lib/new-task'
import { deleteSelectedTaskText, installCrossTaskCut, selectedTaskPlainText } from '../lib/list-edit'
import { useNotebook } from '../store/notebook'
import { tempCountRender } from '../temp-first-paint'

interface DragState {
  x: number
  y: number
  selecting: boolean
}

interface TextMark {
  id: string
  offset: number
}

function rangeAtOffset(element: HTMLElement, offset: number): Range {
  const range = document.createRange()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let textNode = walker.nextNode()
  while (textNode) {
    const length = textNode.textContent?.length ?? 0
    if (remaining <= length) {
      range.setStart(textNode, remaining)
      range.collapse(true)
      return range
    }
    remaining -= length
    textNode = walker.nextNode()
  }
  range.selectNodeContents(element)
  range.collapse(false)
  return range
}

const SELECTION_HIGHLIGHT = 'task-selection'

function caretAt(list: HTMLElement, x: number, y: number): Range | null {
  const rows = list.querySelectorAll<HTMLElement>('[data-task-text]')
  let row: HTMLElement | null = null
  let nearest = Number.POSITIVE_INFINITY
  for (const candidate of rows) {
    const rect = candidate.getBoundingClientRect()
    const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
    if (distance < nearest) {
      nearest = distance
      row = candidate
    }
  }
  if (!row) return document.caretRangeFromPoint(x, y)
  const rect = row.getBoundingClientRect()
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
    return document.caretRangeFromPoint(x, y)
  }
  const range = document.createRange()
  range.selectNodeContents(row)
  range.collapse(x < rect.left + rect.width / 2)
  return range
}

function rangeBetween(list: HTMLElement, x1: number, y1: number, x2: number, y2: number): Range | null {
  const start = caretAt(list, x1, y1)
  const end = caretAt(list, x2, y2)
  if (!start || !end) return null
  const range = document.createRange()
  try {
    if (start.compareBoundaryPoints(Range.START_TO_START, end) <= 0) {
      range.setStart(start.startContainer, start.startOffset)
      range.setEnd(end.startContainer, end.startOffset)
    } else {
      range.setStart(end.startContainer, end.startOffset)
      range.setEnd(start.startContainer, start.startOffset)
    }
  } catch {
    return null
  }
  return range
}

function applyLiveSelection(range: Range): void {
  const selection = window.getSelection()
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(range.cloneRange())
  }
  if (typeof Highlight === 'undefined' || !CSS.highlights) return
  const root = range.commonAncestorContainer
  const list = root instanceof Element ? root.closest('.task-list') : root.parentElement?.closest('.task-list')
  const parts: Range[] = []
  if (list instanceof HTMLElement) {
    for (const node of list.querySelectorAll<HTMLElement>('[data-task-text]')) {
      if (!range.intersectsNode(node)) continue
      const piece = document.createRange()
      piece.selectNodeContents(node)
      if (range.compareBoundaryPoints(Range.START_TO_START, piece) > 0 && node.contains(range.startContainer)) {
        piece.setStart(range.startContainer, range.startOffset)
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, piece) < 0 && node.contains(range.endContainer)) {
        piece.setEnd(range.endContainer, range.endOffset)
      }
      if (!piece.collapsed) parts.push(piece)
    }
  }
  CSS.highlights.set(SELECTION_HIGHLIGHT, new Highlight(...(parts.length > 0 ? parts : [range.cloneRange()])))
}

function clearLiveSelectionPaint(): void {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return
  CSS.highlights.delete(SELECTION_HIGHLIGHT)
}

function markFromBoundary(list: HTMLElement, range: Range, atStart: boolean): TextMark | null {
  const container = atStart ? range.startContainer : range.endContainer
  const offset = atStart ? range.startOffset : range.endOffset
  const parent = container instanceof Element ? container : container.parentElement
  const text = parent?.closest<HTMLElement>('[data-task-text]')
  if (!text?.dataset.taskId || !list.contains(text)) return null
  const before = document.createRange()
  before.selectNodeContents(text)
  try {
    before.setEnd(container, offset)
  } catch {
    return { id: text.dataset.taskId, offset: atStart ? 0 : (text.textContent?.length ?? 0) }
  }
  return { id: text.dataset.taskId, offset: before.toString().length }
}

function spansMultipleTasks(list: HTMLElement, range: Range): boolean {
  let count = 0
  for (const node of list.querySelectorAll<HTMLElement>('[data-task-text]')) {
    const offsets = rangeOffsets(node, range)
    if (!offsets || offsets.start === offsets.end) continue
    count += 1
    if (count > 1) return true
  }
  return false
}

function editingHost(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null
  const element = target instanceof Element ? target : target.parentElement
  const host = element?.closest<HTMLElement>('[data-task-text]')
  if (!host?.isContentEditable) return null
  return host
}

function selectionInsideEditor(): boolean {
  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  if (!anchor) return false
  const element = anchor instanceof Element ? anchor : anchor.parentElement
  return element?.closest<HTMLElement>('[data-task-text]')?.isContentEditable ?? false
}

export function MainListNode() {
  tempCountRender('MainListNode')
  const allTasks = useNotebook((state) => state.tasks)
  const tasks = allTasks.filter((task) => task.side === 'main')
  const ready = useNotebook((state) => state.ready)
  const currentDate = useNotebook((state) => state.currentDate)
  const createTask = useNotebook((state) => state.createTask)
  const setFocusedId = useNotebook((state) => state.setFocusedId)
  const placeholderRef = useRef<HTMLTextAreaElement>(null)
  const focusedId = useNotebook((state) => state.focusedId)
  const listRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragListeners = useRef<(() => void) | null>(null)
  const keepHighlight = useRef(false)
  const pendingSelection = useRef<{ start: TextMark; end: TextMark } | null>(null)
  const pendingSelectAll = useRef(false)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (pendingSelectAll.current) {
      pendingSelectAll.current = false
      const range = document.createRange()
      range.selectNodeContents(list)
      applyLiveSelection(range)
      return
    }
    const marks = pendingSelection.current
    if (!marks) return
    pendingSelection.current = null
    const startElement = list.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(marks.start.id)}"]`)
    const endElement = list.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(marks.end.id)}"]`)
    if (!startElement || !endElement) return
    const start = rangeAtOffset(startElement, marks.start.offset)
    const end = rangeAtOffset(endElement, marks.end.offset)
    const range = document.createRange()
    if (start.compareBoundaryPoints(Range.START_TO_START, end) <= 0) {
      range.setStart(start.startContainer, start.startOffset)
      range.setEnd(end.startContainer, end.startOffset)
    } else {
      range.setStart(end.startContainer, end.startOffset)
      range.setEnd(start.startContainer, start.startOffset)
    }
    applyLiveSelection(range)
  }, [focusedId])

  useEffect(() => {
    if (!ready || tasks.length > 0) return
    placeholderRef.current?.focus()
  }, [currentDate, ready, tasks.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.key === 'Process') return
      if (event.altKey || event.shiftKey) return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (editingHost(event.target) || selectionInsideEditor()) return
      const list = listRef.current
      if (!list) return
      const target = event.target
      const selection = window.getSelection()
      const inList =
        (target instanceof Node && list.contains(target)) ||
        (selection?.anchorNode != null && list.contains(selection.anchorNode))
      if (!inList) return
      event.preventDefault()
      event.stopPropagation()
      list.querySelectorAll<HTMLElement>('[data-task-text]').forEach((node) => {
        if (node.isContentEditable) node.contentEditable = 'false'
      })
      if (useNotebook.getState().focusedId) {
        pendingSelectAll.current = true
        setFocusedId(null)
      } else {
        const range = document.createRange()
        range.selectNodeContents(list)
        applyLiveSelection(range)
      }
    }

    const onCopy = (event: ClipboardEvent): void => {
      const list = listRef.current
      if (!list || !event.clipboardData) return
      const text = selectedTaskPlainText(list)
      if (text == null) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('copy', onCopy)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('copy', onCopy)
    }
  }, [setFocusedId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.key === 'Process') return
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      if (event.shiftKey || event.altKey) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (editingHost(event.target) || selectionInsideEditor()) return
      const list = listRef.current
      if (!list) return
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
      if (!selection.anchorNode || !list.contains(selection.anchorNode)) return
      if (!deleteSelectedTaskText(list)) return
      event.preventDefault()
      event.stopPropagation()
      keepHighlight.current = false
      clearLiveSelectionPaint()
    }
    document.addEventListener('keydown', onKeyDown, true)
    const removeCut = installCrossTaskCut(listRef, () => {
      keepHighlight.current = false
      clearLiveSelectionPaint()
    })
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      removeCut()
    }
  }, [])

  useEffect(() => {
    const onSelectionChange = (): void => {
      if (dragRef.current?.selecting || keepHighlight.current) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) clearLiveSelectionPaint()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      dragListeners.current?.()
      document.removeEventListener('selectionchange', onSelectionChange)
      clearLiveSelectionPaint()
    }
  }, [])

  const finishDrag = (event: PointerEvent): void => {
    const drag = dragRef.current
    const list = listRef.current
    dragRef.current = null
    if (!drag || !list) return
    const range = rangeBetween(list, drag.x, drag.y, event.clientX, event.clientY)
    if (drag.selecting && range && !range.collapsed) {
      keepHighlight.current = true
      applyLiveSelection(range)
      if (useNotebook.getState().focusedId) {
        const start = markFromBoundary(list, range, true)
        const end = markFromBoundary(list, range, false)
        if (start && end) pendingSelection.current = { start, end }
        setFocusedId(null)
      }
      return
    }
    clearLiveSelectionPaint()
    const target = event.target
    if (!(target instanceof Element) || target.closest('.task-check, .branch-dot')) return
    const text = target.closest<HTMLElement>('[data-task-text]')
    const id = text?.dataset.taskId
    if (!id || useNotebook.getState().focusedId === id) return
    const selected = window.getSelection()
    const selectedRange = selected && selected.rangeCount > 0 ? selected.getRangeAt(0) : null
    if (
      text &&
      selectedRange &&
      !selectedRange.collapsed &&
      text.contains(selectedRange.startContainer) &&
      text.contains(selectedRange.endContainer)
    ) {
      setFocusedId(id)
      return
    }
    rememberCaret({ id, x: event.clientX, y: event.clientY })
    setFocusedId(id)
  }

  return (
    <div className="w-[560px] pb-24 pt-2">
      <DateHeader />
      <div
        ref={listRef}
        className="task-list nopan nodrag mt-6"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const target = event.target
          if (target instanceof Element && target.closest('.task-check, .branch-dot')) return
          const list = listRef.current
          if (!list) return
          dragListeners.current?.()
          keepHighlight.current = false
          const drag: DragState = { x: event.clientX, y: event.clientY, selecting: false }
          dragRef.current = drag
          const onMove = (move: PointerEvent): void => {
            if (move.pointerId !== event.pointerId) return
            if (!drag.selecting && Math.hypot(move.clientX - drag.x, move.clientY - drag.y) < 2) return
            const range = rangeBetween(list, drag.x, drag.y, move.clientX, move.clientY)
            if (!range || range.collapsed || !spansMultipleTasks(list, range)) return
            if (!drag.selecting) {
              drag.selecting = true
              list.querySelectorAll<HTMLElement>('[data-task-text]').forEach((node) => {
                if (node.isContentEditable) node.contentEditable = 'false'
              })
            }
            applyLiveSelection(range)
          }
          const onUp = (up: PointerEvent): void => {
            if (up.pointerId !== event.pointerId) return
            dragListeners.current?.()
            finishDrag(up)
          }
          dragListeners.current = () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', onUp)
            document.removeEventListener('pointercancel', onUp)
            dragListeners.current = null
          }
          document.addEventListener('pointermove', onMove)
          document.addEventListener('pointerup', onUp)
          document.addEventListener('pointercancel', onUp)
        }}
      >
        {tasks.map((task) => (
          <TaskBullet key={task.id} task={task} />
        ))}
        {ready && tasks.length === 0 ? (
          <div className="nopan flex items-start gap-3 rounded-[3px] px-2 py-1.5 focus-within:bg-[var(--bg-subtle)]">
            <span aria-hidden="true" className="task-check" />
            <textarea
              ref={placeholderRef}
              className="bullet-input nowheel nopan nodrag w-full resize-none overflow-hidden bg-transparent text-[16px] leading-[1.6] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
              rows={1}
              placeholder="Write a task"
              aria-label="New task"
              onChange={(event) => {
                const text = event.target.value
                if (text !== '') createTask(null, text)
              }}
              onKeyDown={(event) => handleNewTaskKey(event, createTask)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
