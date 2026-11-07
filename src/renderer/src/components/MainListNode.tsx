import { useEffect, useLayoutEffect, useRef } from 'react'
import { DateHeader } from './DateHeader'
import { TaskBullet } from './TaskBullet'
import { rememberCaret, rangeOffsets } from '../lib/caret'
import { useNotebook } from '../store/notebook'

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

function selectedTaskText(list: HTMLElement): string | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  if (!selection.anchorNode || !list.contains(selection.anchorNode)) return null
  const range = selection.getRangeAt(0)
  const lines: string[] = []
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
    lines.push(piece.toString())
  }
  if (lines.length < 2) return null
  return lines.join('\n')
}

export function MainListNode() {
  const tasks = useNotebook((state) => state.tasks)
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
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return
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
      const text = selectedTaskText(list)
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
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      if (event.shiftKey || event.altKey || event.isComposing) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const list = listRef.current
      if (!list) return
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
      if (!selection.anchorNode || !list.contains(selection.anchorNode)) return
      const range = selection.getRangeAt(0)
      const slices: { id: string; node: HTMLElement; text: string; start: number; end: number }[] = []
      for (const node of list.querySelectorAll<HTMLElement>('[data-task-text]')) {
        const offsets = rangeOffsets(node, range)
        const id = node.dataset.taskId
        if (!offsets || !id) continue
        slices.push({ id, node, text: node.textContent ?? '', ...offsets })
      }
      if (slices.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      keepHighlight.current = false
      clearLiveSelectionPaint()
      selection.removeAllRanges()

      const notebook = useNotebook.getState()
      const tasks = notebook.tasks
      const deletions = new Set<string>()
      let caret: { id: string; offset: number } | null = null
      for (const slice of slices) {
        const next = slice.text.slice(0, slice.start) + slice.text.slice(slice.end)
        if (next.replace(/\r?\n/g, '') === '') {
          deletions.add(slice.id)
        } else {
          slice.node.textContent = next
          notebook.updateText(slice.id, next)
          if (!caret) caret = { id: slice.id, offset: slice.start }
        }
      }
      const first = slices[0]
      const last = slices[slices.length - 1]
      const firstIndex = first ? tasks.findIndex((task) => task.id === first.id) : -1
      const lastIndex = last ? tasks.findIndex((task) => task.id === last.id) : -1
      for (const id of deletions) void notebook.deleteTask(id)
      if (caret) {
        useNotebook.getState().focusAt(caret.id, caret.offset)
        return
      }
      const latest = useNotebook.getState().tasks
      const before = tasks
        .slice(0, Math.max(firstIndex, 0))
        .reverse()
        .find((task) => latest.some((item) => item.id === task.id))
      const after = tasks.slice(lastIndex + 1).find((task) => latest.some((item) => item.id === task.id))
      if (before) useNotebook.getState().focusAt(before.id)
      else if (after) useNotebook.getState().focusAt(after.id, 0)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
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
    if (!(target instanceof Element) || target.closest('.task-check')) return
    const text = target.closest<HTMLElement>('[data-task-text]')
    const id = text?.dataset.taskId
    if (!id || useNotebook.getState().focusedId === id) return
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
          if (target instanceof Element && target.closest('.task-check')) return
          const list = listRef.current
          if (!list) return
          dragListeners.current?.()
          keepHighlight.current = false
          const drag: DragState = { x: event.clientX, y: event.clientY, selecting: false }
          dragRef.current = drag
          const onMove = (move: PointerEvent): void => {
            if (move.pointerId !== event.pointerId) return
            if (!drag.selecting && Math.hypot(move.clientX - drag.x, move.clientY - drag.y) < 2) return
            if (!drag.selecting) {
              drag.selecting = true
              list.querySelectorAll<HTMLElement>('[data-task-text]').forEach((node) => {
                if (node.isContentEditable) node.contentEditable = 'false'
              })
            }
            const range = rangeBetween(list, drag.x, drag.y, move.clientX, move.clientY)
            if (!range || range.collapsed) return
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
              className="bullet-input nopan nodrag w-full resize-none overflow-hidden bg-transparent text-[16px] leading-[1.6] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
              rows={1}
              placeholder="Write a task"
              aria-label="New task"
              onChange={(event) => {
                const text = event.target.value
                if (text !== '') createTask(null, text)
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  createTask(null, '')
                }
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
