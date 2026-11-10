import { create } from 'zustand'

export type AppView = 'daily' | 'calendar' | 'map'

interface ViewState {
  view: AppView
  showCalendar: () => void
  showMap: () => void
  showDaily: () => void
}

export const useView = create<ViewState>((set) => ({
  view: 'daily',
  showCalendar: () => set({ view: 'calendar' }),
  showMap: () => set({ view: 'map' }),
  showDaily: () => set({ view: 'daily' }),
}))
