import { useDeleteNotice } from '../store/delete-notice'
import { undoEditing } from '../store/history'
import { tempCountRender } from '../temp-first-paint'

export function DeleteNotice() {
  tempCountRender('DeleteNotice')
  const count = useDeleteNotice()
  if (count === null) return null
  const label = count === 1 ? '1 task' : `${count} tasks`
  return (
    <p className="pointer-events-auto text-center text-[12px] text-[var(--text-muted)]" role="status">
      Deleted {label}.{' '}
      <button
        type="button"
        className="transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[var(--text)]"
        onClick={() => undoEditing()}
      >
        Undo
      </button>
    </p>
  )
}
