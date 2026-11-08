import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { earlierSearchIsOpen } from './earlier-search'
import { useNotebook } from '../store/notebook'

function commandKey(event: KeyboardEvent): boolean {
  const mac = /Mac/i.test(navigator.userAgent)
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

export function installNewTaskShortcut(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key === 'Process' || event.repeat) return
    if (earlierSearchIsOpen()) return
    if (event.key.toLowerCase() !== 'n' || event.altKey || event.shiftKey || !commandKey(event)) return
    event.preventDefault()
    event.stopPropagation()
    useNotebook.getState().createFromFocused()
  }
  document.addEventListener('keydown', onKeyDown, true)
  return () => document.removeEventListener('keydown', onKeyDown, true)
}

function isFirstCharacter(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.nativeEvent.isComposing || event.key === 'Process' || event.key === 'Dead') return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return event.key.length === 1
}

export function handleNewTaskKey(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  createTask: (afterId: string | null, text: string) => string | null,
): void {
  event.stopPropagation()
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    createTask(null, '')
    return
  }
  if (!isFirstCharacter(event)) return
  event.preventDefault()
  flushSync(() => {
    createTask(null, event.key)
  })
}
