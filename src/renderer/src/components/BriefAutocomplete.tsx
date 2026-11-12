import { createPortal } from 'react-dom'
import { acceptComplete, useBriefComplete } from '../store/brief-complete'
import '../styles/brief-complete.css'

// Portalled to the body and placed with position: fixed, so the popup sits at the caret no matter how
// far the canvas is panned or zoomed, and it never inherits a node transform.
export function BriefAutocomplete() {
  const candidates = useBriefComplete((state) => state.candidates)
  const active = useBriefComplete((state) => state.active)
  const x = useBriefComplete((state) => state.x)
  const y = useBriefComplete((state) => state.y)
  const open = useBriefComplete((state) => state.query !== null)

  if (!open || candidates.length === 0) return null

  return createPortal(
    <div
      className="brief-complete"
      data-brief-complete="true"
      role="listbox"
      aria-label="References"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      {candidates.map((candidate, index) => (
        <div
          key={`${candidate.kind}-${candidate.name}`}
          role="option"
          aria-selected={index === active}
          data-brief-complete-item={candidate.name}
          data-brief-complete-kind={candidate.kind}
          data-active={index === active ? 'true' : undefined}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            acceptComplete(index)
          }}
        >
          <span className="brief-complete-name">@{candidate.name}</span>
          <span className="brief-complete-kind">
            {candidate.kind === 'request' ? 'ask the model' : 'brief'}
          </span>
        </div>
      ))}
    </div>,
    document.body,
  )
}
