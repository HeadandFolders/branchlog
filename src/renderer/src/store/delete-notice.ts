import { useSyncExternalStore } from 'react'

export interface DeleteNoticeState {
  count: number
  willCarry: boolean
}

const listeners = new Set<() => void>()
let notice: DeleteNoticeState | null = null
let timer = 0

function emit(): void {
  for (const listener of listeners) listener()
}

export function showDeleteNotice(count: number, willCarry: boolean): void {
  window.clearTimeout(timer)
  notice = { count, willCarry }
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

export function useDeleteNotice(): DeleteNoticeState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => notice,
    () => notice,
  )
}
