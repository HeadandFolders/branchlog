import { localDateKey } from '@shared/dates'
import { dayLabel } from '../lib/day-label'
import { useNotebook } from '../store/notebook'

export function ContinuationMark({ taskId }: { taskId: string }) {
  const mark = useNotebook((state) => state.continuations[taskId])
  if (!mark) return null
  const when = dayLabel(mark.parentDate, localDateKey())
  const text = mark.parentText.trim()
  const title = text === '' ? when : `${text}\n${when}`
  const label = text === '' ? `Continued from an empty task, ${when}` : `Continued from ${text}, ${when}`
  return <span className="continuation-dot nopan" role="img" aria-label={label} title={title} />
}
