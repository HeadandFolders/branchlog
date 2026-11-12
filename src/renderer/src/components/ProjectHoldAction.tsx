import { useState, type MouseEvent } from 'react'
import { pickableBriefs } from '@shared/project-attribution'
import { useBriefs } from '../store/briefs'
import { resolveHold, useProjectHolds } from '../store/project-holds'
import { BriefPicker } from './BriefPicker'

// The row stopped short of a model call because two briefs could answer for it, or none could. This is
// the only thing that says so: one quiet question on the line, and no comment until it is answered.
export function ProjectHoldAction({ taskId }: { taskId: string }) {
  const held = useProjectHolds((state) => state.held.has(taskId))
  const briefs = useBriefs((state) => state.briefs)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  if (!held) return null

  const pick = (briefId: string | null): void => {
    setAnchor(null)
    resolveHold(taskId, briefId)
  }
  // A pick writes the row, and a row that is still being edited keeps whatever is on screen. Letting
  // the click land here is what commits the typing and lets the written name show up.
  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    const button = event.currentTarget
    setAnchor(anchor ? null : button.getBoundingClientRect())
  }

  return (
    <>
      <button
        type="button"
        className="briefs-hold nopan nodrag"
        data-project-hold={taskId}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title="Which project is this about? No note was written until you say."
        onPointerDown={(event) => event.stopPropagation()}
        onClick={toggle}
      >
        Which project?
      </button>
      {anchor ? (
        <BriefPicker
          anchor={anchor}
          label="Project for this task"
          choices={pickableBriefs(briefs).map((brief) => ({ id: brief.id, name: brief.name, current: false }))}
          noneCurrent={false}
          onPick={pick}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </>
  )
}
