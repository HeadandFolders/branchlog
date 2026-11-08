import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  closeThemeLab,
  endGesture,
  getThemeSnapshot,
  getThemeUi,
  redoTheme,
  setEditing,
  setFollowSystem,
  subscribeTheme,
  subscribeThemeUi,
  undoTheme,
} from '../lib/theme-engine'
import { ContrastList, ThemeExchange, ThemeHarmony, ThemePresets } from './ThemeLabTools'
import { ThemeTokenList } from './ThemeTokenList'

export function ThemeLab() {
  const ui = useSyncExternalStore(subscribeThemeUi, getThemeUi)
  if (!ui.open) return null
  return <ThemeLabPanel />
}

function ThemeLabPanel() {
  const doc = useSyncExternalStore(subscribeTheme, getThemeSnapshot)
  const ui = useSyncExternalStore(subscribeThemeUi, getThemeUi)
  const [side, setSide] = useState<'left' | 'right'>('right')
  const [dragLeft, setDragLeft] = useState<number | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const drag = useRef<{ pointer: number; origin: number } | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeThemeLab()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    const undo = key === 'z' && !event.shiftKey
    const redo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey)
    if (!undo && !redo) return
    event.preventDefault()
    event.stopPropagation()
    endGesture()
    if (undo) undoTheme()
    else redoTheme()
  }

  return (
    <aside
      ref={panelRef}
      className="theme-lab nowheel"
      data-theme-lab="true"
      data-side={side}
      role="complementary"
      aria-label="Theme Lab"
      style={dragLeft === null ? undefined : { left: dragLeft, right: 'auto' }}
      onKeyDown={onKeyDown}
    >
      <header
        className="flex items-center justify-between gap-2 px-4 py-3"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const target = event.target
          if (!(target instanceof Element) || target.closest('button, input, label')) return
          const rect = panelRef.current?.getBoundingClientRect()
          if (!rect) return
          drag.current = { pointer: event.clientX, origin: rect.left }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current || !panelRef.current) return
          const width = panelRef.current.offsetWidth
          const max = Math.max(0, window.innerWidth - width)
          const next = drag.current.origin + event.clientX - drag.current.pointer
          setDragLeft(Math.min(max, Math.max(0, next)))
        }}
        onPointerUp={(event) => {
          if (!drag.current || !panelRef.current) return
          drag.current = null
          const rect = panelRef.current.getBoundingClientRect()
          setSide(rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right')
          setDragLeft(null)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
      >
        <h2 className="text-[14px] text-[var(--text)]">Theme Lab</h2>
        <button type="button" onClick={() => setSide(side === 'right' ? 'left' : 'right')}>
          Move to {side === 'right' ? 'left' : 'right'} edge
        </button>
        <button type="button" onClick={() => closeThemeLab()} aria-label="Close Theme Lab">
          Close
        </button>
      </header>
      <div className="theme-lab-body">
        <div role="radiogroup" aria-label="Palette" className="flex gap-3">
          <label>
            <input
              type="radio"
              name="theme-mode"
              checked={ui.editing === 'light'}
              onChange={() => setEditing('light')}
              onClick={() => setEditing('light')}
            />
            Light
          </label>
          <label>
            <input
              type="radio"
              name="theme-mode"
              checked={ui.editing === 'dark'}
              onChange={() => setEditing('dark')}
              onClick={() => setEditing('dark')}
            />
            Dark
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            checked={doc.followSystem}
            onChange={(event) => setFollowSystem(event.target.checked)}
          />
          Follow system
        </label>
        <ThemeTokenList mode={ui.editing} values={doc[ui.editing]} />
        <ContrastList palette={doc[ui.editing]} />
        <ThemeHarmony doc={doc} mode={ui.editing} />
        <ThemePresets doc={doc} comparing={ui.compare} />
        <ThemeExchange doc={doc} exportText={ui.exportText} />
        {ui.error ? (
          <p role="alert" data-theme-error="true">
            {ui.error}
          </p>
        ) : null}
      </div>
    </aside>
  )
}
