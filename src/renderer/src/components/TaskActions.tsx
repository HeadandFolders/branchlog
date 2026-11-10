import { Axe } from 'lucide-react'
import { useAiSettings } from '../store/ai-settings'
import { useNotebook } from '../store/notebook'
import { AskAiAction } from './AskAiAction'
import { LetGoAction } from './LetGoAction'
import { TASK_ACTION_ICON, TaskActionButton } from './TaskActionButton'

interface TaskActionsProps {
  taskId: string
  branch: boolean
  canLetGo: boolean
  dropped: boolean
}

const TASK_ACTION_SLOT = 24

// The width the first line gives up to the row. Slots keep it whether or not a
// control applies, so checking a task done never re-wraps the text beside it.
export function useTaskActionSpace(branch: boolean): number {
  const aiEnabled = useAiSettings((state) => state.settings.enabled)
  return TASK_ACTION_SLOT * (1 + (branch ? 1 : 0) + (branch && aiEnabled ? 1 : 0))
}

export function TaskActions({ taskId, branch, canLetGo, dropped }: TaskActionsProps) {
  const deleteTask = useNotebook((state) => state.deleteTask)
  const aiEnabled = useAiSettings((state) => state.settings.enabled)
  const askEligible = useNotebook((state) => {
    const task = state.tasks.find((item) => item.id === taskId)
    return Boolean(task && task.text.trim() !== '' && !task.done && task.droppedAt === null)
  })

  return (
    <span className="task-actions nopan nodrag">
      <span className="task-action-slot">
        {canLetGo || dropped ? <LetGoAction taskId={taskId} dropped={dropped} /> : null}
      </span>
      {branch && aiEnabled ? (
        <span className="task-action-slot">{askEligible ? <AskAiAction taskId={taskId} /> : null}</span>
      ) : null}
      {branch ? (
        <span className="task-action-slot">
          <TaskActionButton
            targetId={taskId}
            action="delete"
            label="Delete"
            className="branch-delete"
            onActivate={(id) => void deleteTask(id)}
          >
            <Axe {...TASK_ACTION_ICON} />
          </TaskActionButton>
        </span>
      ) : null}
    </span>
  )
}
