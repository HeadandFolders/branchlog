import { create } from 'zustand'
import { defaultAiSettings, type AiSettings } from '@shared/ai-settings'
import type { AiConnectionResult } from '@shared/types'

interface AiSettingsState {
  open: boolean
  settings: AiSettings
  testing: boolean
  connection: AiConnectionResult | null
  error: string
  show: () => void
  hide: () => void
  load: () => void
  update: (patch: Partial<AiSettings>) => void
  testConnection: () => Promise<void>
}

export const useAiSettings = create<AiSettingsState>((set, get) => ({
  open: false,
  settings: defaultAiSettings(),
  testing: false,
  connection: null,
  error: '',

  show: () => {
    set({ open: true, settings: window.branchlog.ai.settings(), connection: null, error: '' })
  },

  hide: () => set({ open: false }),

  load: () => set({ settings: window.branchlog.ai.settings() }),

  update: (patch) => {
    const next = { ...get().settings, ...patch }
    const wrote = window.branchlog.ai.setSettings(next)
    if (!wrote.ok) {
      set({ error: wrote.message })
      return
    }
    set({ settings: next, error: '' })
  },

  testConnection: async () => {
    if (get().testing) return
    set({ testing: true, connection: null })
    try {
      const result = await window.branchlog.ai.testConnection(get().settings.baseUrl)
      set({ testing: false, connection: result })
      if (result.ok && !get().settings.enabled) get().update({ enabled: true })
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : 'Could not complete that request'
      set({ testing: false, connection: { ok: false, message } })
    }
  },
}))

export function toggleAiSettings(): void {
  const state = useAiSettings.getState()
  if (state.open) state.hide()
  else state.show()
}