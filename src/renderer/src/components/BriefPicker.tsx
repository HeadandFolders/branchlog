import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import '../styles/briefs.css'

export interface BriefPickChoice {
  id: string
  name: string
  current: boolean
}

interface BriefPickerProps {
  anchor: DOMRect
  label: string
  choices: readonly BriefPickChoice[]
  noneCurrent: boolean
  onPick: (briefId: string | null) => void
  onClose: () => void
}

// Portalled and placed with position: fixed like the @ reference popup, so it sits at the row whatever
// the canvas is doing, and it never inherits a node transform. Nothing here calls focus(): the picker
// opens without moving the caret out of whatever the person was typing.
export function BriefPicker({ anchor, label, choices, noneCurrent, onPick, onClose }: BriefPickerProps) {
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const node = box.current
      if (node && event.target instanceof Node && node.contains(event.target)) return
      onClose()
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [onClose])

  return createPortal(
    <div
      ref={box}
      className="briefs-pick"
      data-brief-picker="true"
      role="menu"
      aria-label={label}
      style={{ left: `${anchor.left}px`, top: `${anchor.bottom + 6}px` }}
    >
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          role="menuitemradio"
          aria-checked={choice.current}
          data-brief-pick={choice.id}
          data-current={choice.current || undefined}
          className="briefs-pick-row"
          onClick={() => onPick(choice.id)}
        >
          <span className="briefs-pick-name">{choice.name}</span>
        </button>
      ))}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={noneCurrent}
        data-brief-pick="none"
        data-current={noneCurrent || undefined}
        className="briefs-pick-row"
        onClick={() => onPick(null)}
      >
        <span className="briefs-pick-name">No project</span>
      </button>
    </div>,
    document.body,
  )
}
