import { rangeFromOffsets, type KeepRange } from './keep-ranges'

export interface TextPiece {
  node: Text
  start: number
  length: number
}

export function textPieces(root: Node): TextPiece[] {
  const pieces: TextPiece[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    const holder = text.parentElement?.closest('[data-offset]')
    if (holder && root.contains(holder) && !text.parentElement?.closest('[data-ellipsis]')) {
      const start = Number(holder.getAttribute('data-offset'))
      if (Number.isInteger(start) && text.data.length > 0) {
        pieces.push({ node: text, start, length: text.data.length })
      }
    }
    node = walker.nextNode()
  }
  return pieces
}

export function domRange(root: Node, [start, end]: KeepRange): Range | null {
  const pieces = textPieces(root)
  const anchor = pieces.find((piece) => start >= piece.start && start <= piece.start + piece.length)
  const focus = pieces.find((piece) => end >= piece.start && end <= piece.start + piece.length)
  if (!anchor || !focus) return null
  const range = document.createRange()
  range.setStart(anchor.node, start - anchor.start)
  range.setEnd(focus.node, end - focus.start)
  return range
}

export function selectionRange(root: Node, selection: Selection): KeepRange | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null
  const { anchorNode, focusNode } = selection
  if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) return null
  const native = selection.getRangeAt(0)
  const pieces = textPieces(root).filter((piece) => native.intersectsNode(piece.node))
  const first = pieces[0]
  const last = pieces.at(-1)
  if (!first || !last) return null
  const start = native.startContainer === first.node ? native.startOffset : 0
  const end = native.endContainer === last.node ? native.endOffset : last.length
  return rangeFromOffsets(pieces, 0, start, pieces.length - 1, end)
}