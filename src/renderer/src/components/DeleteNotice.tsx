import { useDeleteNotice } from '../store/delete-notice'
import { undoEditing } from '../store/history'
import { tempCountRender } from '../temp-first-paint'

export function DeleteNotice() {
  tempCountRender('DeleteNotice')
  const notice = useDeleteNotice()
  if (notice === null) return null
  const label = notice.willCarry
    ? 'Removed for today. It will carry over again tomorrow.'
    : `Deleted ${notice.count === 1 ? '1 task' : `${notice.count} tasks`}.`
  return (
    <p className="pointer-events-auto text-center text-[12px] text-[var(--text-muted)]" role="status">
      {label}{' '}
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
