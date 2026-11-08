import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
let notice: number | null = null
let timer = 0

function emit(): void {
  for (const listener of listeners) listener()
}

export function showDeleteNotice(count: number): void {
  window.clearTimeout(timer)
  notice = count
  timer = window.setTimeout(() => {
    notice = null
    emit()
  }, 8000)
  emit()
}

export function hideDeleteNotice(): void {
  window.clearTimeout(timer)
  if (notice === null) return
  notice = null
  emit()
}

export function useDeleteNotice(): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => notice,
    () => notice,
  )
}
