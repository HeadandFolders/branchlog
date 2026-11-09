import { CircleSlash2 } from 'lucide-react'
import { droppedLabel } from '../lib/state-label'

export function DroppedMark({ day }: { day: string }) {
  const label = droppedLabel(day)
  return (
    <span className="task-state-mark nopan" data-mark="dropped" role="img" aria-label={label} title={label}>
      <CircleSlash2 size={12} strokeWidth={1.5} />
    </span>
  )
}
