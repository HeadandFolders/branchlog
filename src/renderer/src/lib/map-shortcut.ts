import { useView } from '../store/view'

function commandKey(event: KeyboardEvent): boolean {
  const mac = /Mac/i.test(navigator.userAgent)
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

export function installMapShortcut(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process' || event.repeat) return
    if (event.key.toLowerCase() !== 'm' || event.altKey || event.shiftKey || !commandKey(event)) return
    event.preventDefault()
    event.stopPropagation()
    const view = useView.getState()
    if (view.view === 'map') view.showDaily()
    else view.showMap()
  }
  document.addEventListener('keydown', onKeyDown, true)
  return () => document.removeEventListener('keydown', onKeyDown, true)
}
