import { create } from 'zustand'

export type AppView = 'daily' | 'calendar'

interface ViewState {
  view: AppView
  showCalendar: () => void
  showDaily: () => void
}

export const useView = create<ViewState>((set) => ({
  view: 'daily',
  showCalendar: () => set({ view: 'calendar' }),
  showDaily: () => set({ view: 'daily' }),
}))
