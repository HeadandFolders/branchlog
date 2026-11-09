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

export function selectionRange(root: Node, selection: Selection): KeepRange | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) return null
  const pieces = textPieces(root)
  const anchorIndex = pieces.findIndex((piece) => piece.node === anchorNode)
  const focusIndex = pieces.findIndex((piece) => piece.node === focusNode)
  if (anchorIndex < 0 || focusIndex < 0) return null
  return rangeFromOffsets(pieces, anchorIndex, anchorOffset, focusIndex, focusOffset)
}