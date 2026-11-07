interface CaretPoint {
  id: string
  x: number
  y: number
}

let pending: CaretPoint | null = null

export function rememberCaret(point: CaretPoint): void {
  pending = point
}

export function takeCaret(id: string): CaretPoint | null {
  if (pending?.id !== id) return null
  const point = pending
  pending = null
  return point
}

export function caretOffset(element: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEnd(container, offset)
  return range.toString().length
}

export function caretOffsets(element: HTMLElement): { start: number; end: number } {
  const length = element.textContent?.length ?? 0
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return { start: length, end: length }
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer)) return { start: length, end: length }
  try {
    const start = caretOffset(element, range.startContainer, range.startOffset)
    const end = element.contains(range.endContainer)
      ? caretOffset(element, range.endContainer, range.endOffset)
      : start
    return start <= end ? { start, end } : { start: end, end: start }
  } catch {
    return { start: length, end: length }
  }
}

export function rangeOffsets(element: HTMLElement, range: Range): { start: number; end: number } | null {
  if (!range.intersectsNode(element)) return null
  const length = element.textContent?.length ?? 0
  let start = 0
  let end = length
  try {
    if (element.contains(range.startContainer)) start = caretOffset(element, range.startContainer, range.startOffset)
    if (element.contains(range.endContainer)) end = caretOffset(element, range.endContainer, range.endOffset)
  } catch {
    return null
  }
  if (end < start) {
    const swap = start
    start = end
    end = swap
  }
  if (start === end) {
    if (length > 0 || range.collapsed) return null
    const covered = document.createRange()
    covered.selectNodeContents(element)
    const startsBefore = range.compareBoundaryPoints(Range.START_TO_START, covered) <= 0
    const endsAfter = range.compareBoundaryPoints(Range.END_TO_END, covered) >= 0
    if (!startsBefore || !endsAfter) return null
  }
  return { start, end }
}

export function placeCaret(element: HTMLElement, offset: number): void {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, offset)
  let textNode = walker.nextNode()
  while (textNode) {
    const length = textNode.textContent?.length ?? 0
    if (remaining <= length) {
      range.setStart(textNode, remaining)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    remaining -= length
    textNode = walker.nextNode()
  }
  range.selectNodeContents(element)
  range.collapse(offset <= 0)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function insertPlainText(element: HTMLElement, insert: string): string {
  const { start, end } = caretOffsets(element)
  const current = element.textContent ?? ''
  const next = current.slice(0, start) + insert + current.slice(end)
  if (element.textContent !== next) element.textContent = next
  placeCaret(element, start + insert.length)
  return next
}
