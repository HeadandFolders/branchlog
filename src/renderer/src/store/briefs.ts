import { create } from 'zustand'
import { normalizeBriefName, type BriefView } from '@shared/ai-briefs'
import { matchBriefRef } from '@shared/brief-refs'

interface BriefsState {
  briefs: BriefView[]
  loading: boolean
  loaded: boolean
  error: string | null
  load: (force?: boolean) => Promise<void>
}

// The panel and the typing path both need the same list, so one store holds it and nobody else asks.
export const useBriefs = create<BriefsState>((set, get) => ({
  briefs: [],
  loading: false,
  loaded: false,
  error: null,

  load: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return
    set({ loading: true })
    try {
      set({ briefs: await window.branchlog.briefs.list(), loaded: true, loading: false, error: null })
    } catch (error) {
      console.error(error)
      set({ loaded: true, loading: false, error: 'The brief list could not be read.' })
    }
  },
}))

export function refreshBriefs(): Promise<void> {
  return useBriefs.getState().load()
}

export function reloadBriefs(): Promise<void> {
  return useBriefs.getState().load(true)
}

export function briefRefNames(): string[] {
  return useBriefs.getState().briefs.map((brief) => brief.name)
}

// The last @<brief name> in the row is its binding, and a row with no ref left has no binding. Every
// text write re-reads the whole row, so an undo, a paste or a cut all arrive at the right answer.
export function projectRefForText(text: string): string | null {
  const state = useBriefs.getState()
  const ref = matchBriefRef(text, briefRefNames())
  if (ref === null) return null
  const name = normalizeBriefName(ref.name)
  return state.briefs.find((brief) => normalizeBriefName(brief.name) === name)?.id ?? null
}
