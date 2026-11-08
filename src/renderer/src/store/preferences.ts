import { create } from 'zustand'
import { useNotebook } from './notebook'

type PreferencesState = {
  swipeToPan: boolean
  load: () => void
  setSwipeToPan: (on: boolean) => void
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  swipeToPan: true,
  load: () => {
    set({ swipeToPan: window.branchlog.settings.swipeToPan() })
  },
  setSwipeToPan: (on) => {
    const previous = get().swipeToPan
    set({ swipeToPan: on })
    const result = window.branchlog.settings.setSwipeToPan(on)
    if (result.ok) return
    set({ swipeToPan: previous })
    useNotebook.setState({ error: 'Could not save that setting.' })
  },
}))
