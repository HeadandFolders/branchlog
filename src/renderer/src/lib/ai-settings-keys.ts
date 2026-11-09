import { toggleAiSettings, useAiSettings } from '../store/ai-settings'

export function installAiSettingsShortcut(): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process' || event.repeat) return
    if (event.key === 'Escape' && useAiSettings.getState().open) {
      event.preventDefault()
      event.stopPropagation()
      useAiSettings.getState().hide()
      return
    }
    if (event.key !== ',' || event.altKey || event.shiftKey) return
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    event.stopPropagation()
    toggleAiSettings()
  }
  document.addEventListener('keydown', onKey, true)
  return () => document.removeEventListener('keydown', onKey, true)
}