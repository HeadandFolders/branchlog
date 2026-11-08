type OpenListener = (open: boolean) => void

const listeners = new Set<OpenListener>()
let open = false

export function earlierSearchIsOpen(): boolean {
  return open
}

export function setEarlierSearchOpen(next: boolean): void {
  open = next
}

export function watchEarlierSearch(listener: OpenListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openEarlierSearch(): void {
  for (const listener of listeners) listener(true)
}

export function closeEarlierSearch(): void {
  for (const listener of listeners) listener(false)
}

function commandKey(event: KeyboardEvent): boolean {
  const mac = /Mac/i.test(navigator.userAgent)
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

export function installEarlierShortcut(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process' || event.repeat) return
    if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey || !commandKey(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (open) closeEarlierSearch()
    else openEarlierSearch()
  }
  document.addEventListener('keydown', onKeyDown, true)
  return () => document.removeEventListener('keydown', onKeyDown, true)
}
