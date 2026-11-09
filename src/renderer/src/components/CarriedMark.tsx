import { CornerUpRight } from 'lucide-react'
import { carriedLabel } from '../lib/state-label'

interface CarriedMarkProps {
  fromDay: string
  days: number
}

export function CarriedMark({ fromDay, days }: CarriedMarkProps) {
  const label = carriedLabel(fromDay, days)
  return (
    <span
      className="task-state-mark nopan"
      data-mark="carried"
      data-carried-days={days}
      role="img"
      aria-label={label}
      title={label}
    >
      <CornerUpRight size={12} strokeWidth={1.5} />
    </span>
  )
}
