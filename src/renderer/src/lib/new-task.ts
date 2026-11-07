import type { KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { placeCaret } from './caret'

function isFirstCharacter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.nativeEvent.isComposing || event.key === 'Process' || event.key === 'Dead') return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return event.key.length === 1
}

export function handleNewTaskKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  createTask: (afterId: string | null, text: string) => string | null,
): void {
  event.stopPropagation()
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    createTask(null, '')
    return
  }
  if (!isFirstCharacter(event)) return
  event.preventDefault()
  const id = flushSync(() => createTask(null, event.key))
  if (!id) return
  const field = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
  if (!field) return
  field.focus()
  placeCaret(field, event.key.length)
}
