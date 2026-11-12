import { create } from 'zustand'
import { applyRefAccept, refCandidates, refQueryAt, type RefCandidate, type RefQuery } from '@shared/brief-refs'
import { placeCaret } from '../lib/caret'
import { briefRefNames } from './briefs'
import { useNotebook } from './notebook'

interface Anchor {
  element: HTMLElement
  taskId: string
}

interface CompleteState {
  anchor: Anchor | null
  query: RefQuery | null
  candidates: RefCandidate[]
  active: number
  x: number
  y: number
  open: (anchor: Anchor, caret: number) => void
  close: () => void
  move: (delta: number) => void
  accept: (index?: number) => boolean
}

function caretPoint(element: HTMLElement): { x: number; y: number } {
  const selection = window.getSelection()
  const rect = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null
  if (rect && (rect.height > 0 || rect.width > 0)) return { x: rect.left, y: rect.bottom }
  const box = element.getBoundingClientRect()
  return { x: box.left, y: box.bottom }
}

// The list is drawn where the caret is, in viewport coordinates, so it never drifts with the canvas:
// the popup is portalled out of the React Flow transform.
export const useBriefComplete = create<CompleteState>((set, get) => ({
  anchor: null,
  query: null,
  candidates: [],
  active: 0,
  x: 0,
  y: 0,

  open: (anchor, caret) => {
    const query = refQueryAt(anchor.element.textContent ?? '', caret)
    const candidates = query === null ? [] : refCandidates(query.query, briefRefNames())
    if (query === null || candidates.length === 0) {
      get().close()
      return
    }
    const previous = get()
    // The row stays put while the query grows, so only a new reference resets the highlighted row.
    const active =
      previous.anchor?.taskId === anchor.taskId && previous.query?.start === query.start
        ? Math.min(previous.active, candidates.length - 1)
        : 0
    const point = caretPoint(anchor.element)
    set({ anchor, query, candidates, active, x: point.x, y: point.y })
  },

  close: () => {
    if (get().query === null) return
    set({ anchor: null, query: null, candidates: [], active: 0 })
  },

  move: (delta) => {
    const { candidates, active } = get()
    if (candidates.length === 0) return
    set({ active: (active + delta + candidates.length) % candidates.length })
  },

  accept: (index) => {
    const state = get()
    const chosen = index ?? state.active
    const candidate = state.candidates[chosen]
    const anchor = state.anchor
    if (!state.query || !candidate || !anchor || !anchor.element.isConnected) return false
    const written = applyRefAccept(anchor.element.textContent ?? '', state.query, candidate.name)
    anchor.element.textContent = written.text
    placeCaret(anchor.element, written.caret)
    useNotebook.getState().updateText(anchor.taskId, written.text)
    state.close()
    return true
  },
}))

export function openComplete(anchor: Anchor, caret: number): void {
  useBriefComplete.getState().open(anchor, caret)
}

export function closeComplete(): void {
  useBriefComplete.getState().close()
}

export function completeIsOpen(): boolean {
  return useBriefComplete.getState().query !== null
}

export function acceptComplete(index?: number): boolean {
  return useBriefComplete.getState().accept(index)
}

export function moveComplete(delta: number): void {
  useBriefComplete.getState().move(delta)
}

export type { Anchor }
