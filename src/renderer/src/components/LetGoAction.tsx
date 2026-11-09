import { memo } from 'react'
import { Undo2, Wind } from 'lucide-react'
import { droppedLabel } from '../lib/state-label'
import { useNotebook } from '../store/notebook'

interface LetGoActionProps {
  taskId: string
  dropped: boolean
  dropDay: string | null
}

export const LetGoAction = memo(function LetGoAction({ taskId, dropped, dropDay }: LetGoActionProps) {
  const setDropped = useNotebook((state) => state.setDropped)
  const label = dropped ? 'Undo drop' : "Let go (won't carry over)"
  const tip = dropped && dropDay ? droppedLabel(dropDay) : label

  return (
    <span className="task-actions nopan nodrag">
      <button
        type="button"
        className="task-action nodrag nopan"
        data-action={dropped ? 'undrop' : 'let-go'}
        aria-label={label}
        title={tip}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void setDropped(taskId, !dropped)}
      >
        {dropped ? <Undo2 size={13} strokeWidth={1.5} /> : <Wind size={13} strokeWidth={1.5} />}
      </button>
    </span>
  )
})
