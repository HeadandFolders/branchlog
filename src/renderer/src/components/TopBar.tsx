import { useEffect, useId, useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import { toggleThemeLab } from '../lib/theme-engine'
import { framePageNow } from '../lib/viewport'
import { useNotebook } from '../store/notebook'
import { usePreferences } from '../store/preferences'
import { tempCountRender } from '../temp-first-paint'

const shortcutMod = /Mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'

export function TopBar() {
  tempCountRender('TopBar')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const runMenuAction = useNotebook((state) => state.runMenuAction)
  const autoSeparate = usePreferences((state) => state.autoSeparate)
  const setAutoSeparate = usePreferences((state) => state.setAutoSeparate)
  const swipeToPan = usePreferences((state) => state.swipeToPan)
  const setSwipeToPan = usePreferences((state) => state.setSwipeToPan)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const items: { action: 'new-task' | 'today' | 'prev-day' | 'next-day'; label: string; shortcut: string }[] = [
    { action: 'new-task', label: 'New task', shortcut: `${shortcutMod}+N` },
    { action: 'today', label: 'Go to Today', shortcut: `${shortcutMod}+T` },
    { action: 'prev-day', label: 'Previous day', shortcut: '' },
    { action: 'next-day', label: 'Next day', shortcut: '' },
  ]

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 px-4">
      <div ref={rootRef} className="relative">
        <button
          type="button"
          className="flex size-6 items-center justify-center text-[var(--text-muted)] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[var(--text)]"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <Menu size={16} strokeWidth={1.5} />
        </button>
        {open ? (
          <div
            id={menuId}
            role="menu"
            className="nowheel absolute left-0 top-8 z-20 max-h-[70vh] min-w-56 overflow-y-auto rounded-[6px] border border-[var(--line)] bg-[var(--bg)] py-1"
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={autoSeparate}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-[var(--text-muted)] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
              onClick={() => setAutoSeparate(!autoSeparate)}
            >
              <span>Auto-separate nodes</span>
              {autoSeparate ? <span className="text-[12px] text-[var(--text-faint)]">On</span> : null}
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={swipeToPan}
              className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[13px] text-[var(--text-muted)] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
              onClick={() => setSwipeToPan(!swipeToPan)}
            >
              <span>Trackpad: swipe to pan (off = scroll to zoom)</span>
              {swipeToPan ? <span className="text-[12px] text-[var(--text-faint)]">On</span> : null}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-[var(--text-muted)] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
              onClick={() => {
                setOpen(false)
                toggleThemeLab()
              }}
            >
              <span>Theme Lab</span>
              <span className="text-[12px] text-[var(--text-faint)]">{shortcutMod}+Shift+T</span>
            </button>
            {items.map((item) => (
              <button
                key={item.action}
                type="button"
                role="menuitem"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-[var(--text-muted)] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                onClick={() => {
                  setOpen(false)
                  runMenuAction(item.action)
                }}
              >
                <span>{item.label}</span>
                {item.shortcut ? <span className="text-[12px] text-[var(--text-faint)]">{item.shortcut}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="flex items-center gap-2 font-serif text-[14px] font-semibold text-[var(--text)]"
        onClick={framePageNow}
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--accent-dot)]" />
        branchlog.
      </button>
    </header>
  )
}
