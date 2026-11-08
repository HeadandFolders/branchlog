import { create } from 'zustand'
import { useNotebook } from './notebook'

interface PreferenceState {
  autoSeparate: boolean
  swipeToPan: boolean
  loaded: boolean
  load: () => void
  setAutoSeparate: (on: boolean) => void
  setSwipeToPan: (on: boolean) => void
}

export const usePreferences = create<PreferenceState>((set, get) => ({
  autoSeparate: true,
  swipeToPan: true,
  loaded: false,

  load: () => {
    try {
      set({
        autoSeparate: window.branchlog.settings.autoSeparate(),
        swipeToPan: window.branchlog.settings.swipeToPan(),
        loaded: true,
      })
    } catch (error) {
      console.error(error)
      set({ autoSeparate: true, swipeToPan: true, loaded: true })
    }
  },

  setAutoSeparate: (on) => {
    const previous = get().autoSeparate
    set({ autoSeparate: on })
    const wrote = window.branchlog.settings.setAutoSeparate(on)
    if (wrote.ok) return
    set({ autoSeparate: previous })
    useNotebook.setState({ error: 'Could not save that setting.' })
  },

  setSwipeToPan: (on) => {
    const previous = get().swipeToPan
    set({ swipeToPan: on })
    const wrote = window.branchlog.settings.setSwipeToPan(on)
    if (wrote.ok) return
    set({ swipeToPan: previous })
    useNotebook.setState({ error: 'Could not save that setting.' })
  },
}))

export function autoSeparateEnabled(): boolean {
  return usePreferences.getState().autoSeparate
}
