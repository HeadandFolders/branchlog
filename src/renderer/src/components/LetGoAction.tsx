import { memo } from 'react'
import { Undo2, Wind } from 'lucide-react'
import { useNotebook } from '../store/notebook'
import { TASK_ACTION_ICON, TaskActionButton } from './TaskActionButton'

interface LetGoActionProps {
  taskId: string
  dropped: boolean
}

// The button says only what clicking does; the day it was let go is the marker's fact.
export const LetGoAction = memo(function LetGoAction({ taskId, dropped }: LetGoActionProps) {
  const setDropped = useNotebook((state) => state.setDropped)
  const label = dropped ? 'Undo drop' : "Let go (won't carry over)"

  return (
    <TaskActionButton
      targetId={taskId}
      action={dropped ? 'undrop' : 'let-go'}
      label={label}
      onActivate={(id) => void setDropped(id, !dropped)}
    >
      {dropped ? <Undo2 {...TASK_ACTION_ICON} /> : <Wind {...TASK_ACTION_ICON} />}
    </TaskActionButton>
  )
})
