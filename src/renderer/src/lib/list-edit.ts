import type { RefObject } from 'react'
import { rangeOffsets } from './caret'
import { batchEdits } from '../store/history'
import { useNotebook } from '../store/notebook'

export function selectedTaskPlainText(list: HTMLElement): string | null {
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

export function deleteSelectedTaskText(list: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false
  if (!selection.anchorNode || !list.contains(selection.anchorNode)) return false
  const range = selection.getRangeAt(0)
  const slices: { id: string; node: HTMLElement; text: string; start: number; end: number }[] = []
  for (const node of list.querySelectorAll<HTMLElement>('[data-task-text]')) {
    const offsets = rangeOffsets(node, range)
    const id = node.dataset.taskId
    if (!offsets || !id) continue
    slices.push({ id, node, text: node.textContent ?? '', ...offsets })
  }
  if (slices.length === 0) return false
  selection.removeAllRanges()
  batchEdits(() => {
    const notebook = useNotebook.getState()
    let caret: { id: string; offset: number } | null = null
    for (const slice of slices) {
      const next = slice.text.slice(0, slice.start) + slice.text.slice(slice.end)
      slice.node.textContent = next
      notebook.updateText(slice.id, next)
      if (!caret) caret = { id: slice.id, offset: slice.start }
    }
    if (caret) useNotebook.getState().focusAt(caret.id, caret.offset)
  })
  return true
}

export function cutSelectedTaskText(list: HTMLElement): boolean {
  if (selectedTaskPlainText(list) == null) return false
  document.execCommand('copy')
  return deleteSelectedTaskText(list)
}

export function cutFromMenu(): void {
  const list = document.querySelector('.task-list')
  if (list instanceof HTMLElement && cutSelectedTaskText(list)) return
  document.execCommand('cut')
}

export function copyFromMenu(): void {
  document.execCommand('copy')
}

export function selectAllFromMenu(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && active.matches('[data-task-text]')) {
    const range = document.createRange()
    range.selectNodeContents(active)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return
  }
  const list = document.querySelector('.task-list')
  if (!(list instanceof HTMLElement)) return
  const range = document.createRange()
  range.selectNodeContents(list)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function installCrossTaskCut(
  listRef: RefObject<HTMLElement | null>,
  onCut: () => void,
): () => void {
  const cut = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process') return
    if (event.shiftKey || event.altKey) return
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'x') return
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    const list = listRef.current
    if (!list || !cutSelectedTaskText(list)) return
    event.preventDefault()
    event.stopPropagation()
    onCut()
  }
  document.addEventListener('keydown', cut, true)
  return () => document.removeEventListener('keydown', cut, true)
}
