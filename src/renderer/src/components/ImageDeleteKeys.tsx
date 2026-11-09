import { useEffect } from 'react'
import { useStoreApi } from '@xyflow/react'
import { useImages } from '../store/images'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null
}

export function ImageDeleteKeys() {
  const store = useStoreApi()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Backspace' || event.isComposing || event.repeat) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target)) return
      const ids = store
        .getState()
        .nodes.filter((node) => node.selected && node.type === 'image')
        .map((node) => node.id)
      if (ids.length === 0) return
      event.preventDefault()
      useImages.getState().remove(ids)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [store])

  return null
}
