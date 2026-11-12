import { useState, type MouseEvent } from 'react'
import { useAiComments } from '../store/ai-comments'
import { useBriefs } from '../store/briefs'
import { useNotebook } from '../store/notebook'
import { BriefPicker } from './BriefPicker'

// The answer says what it was written about. Reading the chip is the point of it, and clicking it is
// how the person says the label was wrong — which is a label, so nothing is sent to the model.
export function ProjectChip({ commentId }: { commentId: string }) {
  const comment = useAiComments((state) => state.comments.find((item) => item.id === commentId))
  const setProject = useAiComments((state) => state.setProject)
  const briefs = useBriefs((state) => state.briefs)
  const boundProjectId = useNotebook((state) => {
    const taskId = comment?.taskId
    if (taskId === undefined) return null
    return state.tasks.find((task) => task.id === taskId)?.projectId ?? null
  })
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  if (!comment) return null

  const projectId = comment.projectId
  const brief = projectId === null ? undefined : briefs.find((item) => item.id === projectId)
  // The row itself already named this brief, so the label is the row's own binding. A guess is the one
  // the keyword match made, and only a pinned comment is something the person said for themselves.
  const auto = projectId !== null && !comment.projectPinned && projectId !== boundProjectId
  const title =
    brief === undefined
      ? 'No project. Click to pick one.'
      : auto
        ? `${brief.name} — matched to this task. Click to change.`
        : comment.projectPinned
          ? `${brief.name} — as you labelled it. Click to change.`
          : `${brief.name} — the project this row names.`

  const pick = (briefId: string | null): void => {
    setAnchor(null)
    setProject(commentId, briefId)
  }
  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())
  }

  return (
    <>
      <button
        type="button"
        className="briefs-chip"
        data-project-chip={commentId}
        data-project-id={projectId ?? 'none'}
        data-project-auto={auto || undefined}
        data-project-pinned={comment.projectPinned || undefined}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title={title}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={toggle}
      >
        {brief?.name ?? 'No project'}
        {auto ? <span className="briefs-chip-auto">auto</span> : null}
      </button>
      {anchor ? (
        <BriefPicker
          anchor={anchor}
          label="Project for this note"
          choices={briefs
            .filter((brief) => brief.enabled)
            .map((item) => ({ id: item.id, name: item.name, current: item.id === projectId }))}
          noneCurrent={projectId === null}
          onPick={pick}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </>
  )
}
