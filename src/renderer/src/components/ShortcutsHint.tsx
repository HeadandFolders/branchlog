import { useEffect, useId, useRef, useState } from 'react'
import { Keyboard } from 'lucide-react'
import { shortcutGroups } from '../lib/shortcuts'

export function ShortcutsHint() {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const revealed = pinned || hovered

  useEffect(() => {
    if (!pinned) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setPinned(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      // A pinned note is the top layer, so Escape closes it instead of the panel behind it.
      event.stopImmediatePropagation()
      setPinned(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [pinned])

  return (
    <div
      ref={rootRef}
      className="shortcuts-hint"
      data-revealed={revealed ? 'true' : 'false'}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="shortcuts-hint-trigger"
        aria-label="Keyboard shortcuts"
        aria-expanded={revealed}
        aria-controls={panelId}
        onClick={() => setPinned((value) => !value)}
      >
        <Keyboard size={15} strokeWidth={1.5} />
      </button>
      <div
        id={panelId}
        role="group"
        aria-label="Keyboard shortcuts"
        className="shortcuts-panel"
      >
        {shortcutGroups.map((group) => (
          <div className="shortcuts-group" key={group.title}>
            <div className="shortcuts-title">{group.title}</div>
            {group.rows.map((row) => (
              <div className="shortcuts-row" key={row.label}>
                <span className="shortcuts-label">{row.label}</span>
                <span className="shortcuts-keys">{row.keys}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
