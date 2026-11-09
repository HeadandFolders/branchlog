import { create } from 'zustand'
import { useNotebook } from './notebook'

interface PreferenceState {
  autoSeparate: boolean
  swipeToPan: boolean
  autoCarry: boolean
  highlightCarried: boolean
  loaded: boolean
  load: () => void
  setAutoSeparate: (on: boolean) => void
  setSwipeToPan: (on: boolean) => void
  setAutoCarry: (on: boolean) => void
  setHighlightCarried: (on: boolean) => void
}

export const usePreferences = create<PreferenceState>((set, get) => ({
  autoSeparate: true,
  swipeToPan: true,
  autoCarry: true,
  highlightCarried: true,
  loaded: false,

  load: () => {
    try {
      set({
        autoSeparate: window.branchlog.settings.autoSeparate(),
        swipeToPan: window.branchlog.settings.swipeToPan(),
        autoCarry: window.branchlog.settings.autoCarry(),
        highlightCarried: window.branchlog.settings.highlightCarried(),
        loaded: true,
      })
    } catch (error) {
      console.error(error)
      set({ autoSeparate: true, swipeToPan: true, autoCarry: true, highlightCarried: true, loaded: true })
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

  setAutoCarry: (on) => {
    const previous = get().autoCarry
    set({ autoCarry: on })
    const wrote = window.branchlog.settings.setAutoCarry(on)
    if (wrote.ok) return
    set({ autoCarry: previous })
    useNotebook.setState({ error: 'Could not save that setting.' })
  },

  setHighlightCarried: (on) => {
    const previous = get().highlightCarried
    set({ highlightCarried: on })
    const wrote = window.branchlog.settings.setHighlightCarried(on)
    if (wrote.ok) return
    set({ highlightCarried: previous })
    useNotebook.setState({ error: 'Could not save that setting.' })
  },
}))

export function autoSeparateEnabled(): boolean {
  return usePreferences.getState().autoSeparate
}
