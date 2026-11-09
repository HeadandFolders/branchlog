import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Pin } from 'lucide-react'
import {
  clampRanges,
  displaySegments,
  mergeRanges,
  parseRanges,
  removeRange,
  serializeRanges,
  type KeepRange,
} from '../lib/keep-ranges'
import { domRange, selectionRange } from '../lib/keep-selection'

interface RemovePick {
  index: number
  left: number
  top: number
}

interface KeepHideTextProps {
  text: string
  keptRanges: string
  onChange: (keptRanges: string) => void
  toolbar: HTMLElement | null
  expanded: boolean
  onKeep: () => void
  onSelectionChange: (element: HTMLElement, active: boolean) => void
}

function clearSelectionIn(wrapper: HTMLElement | null): void {
  const selection = window.getSelection()
  if (selection?.anchorNode && wrapper?.contains(selection.anchorNode)) selection.removeAllRanges()
}

export function KeepHideText({ text, keptRanges, onChange, toolbar, expanded, onKeep, onSelectionChange }: KeepHideTextProps): ReactElement {
  const ranges = clampRanges(parseRanges(keptRanges), text.length)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const pinRef = useRef<HTMLButtonElement>(null)
  const selectingPointer = useRef<number | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [keepPick, setKeepPick] = useState<KeepRange | null>(null)
  const [removePick, setRemovePick] = useState<RemovePick | null>(null)
  const [pendingRanges, setPendingRanges] = useState<KeepRange[]>([])
  const collapsed = ranges.length > 0 && !expanded && !selecting && !keepPick && pendingRanges.length === 0

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (wrapper) onSelectionChange(wrapper, selecting || keepPick !== null || pendingRanges.length > 0)
  }, [selecting, keepPick, pendingRanges.length, onSelectionChange])

  useEffect(() => {
    const wrapper = wrapperRef.current
    return () => {
      if (wrapper) onSelectionChange(wrapper, false)
    }
  }, [onSelectionChange])

  useEffect(() => {
    const onSelection = (): void => {
      const wrapper = wrapperRef.current
      const selection = window.getSelection()
      if (!wrapper || !selection) {
        setKeepPick(null)
        return
      }
      const range = selectionRange(wrapper, selection)
      if (!range) {
        if (pendingRanges.length === 0) setKeepPick(null)
        return
      }
      setKeepPick((current) => current?.[0] === range[0] && current[1] === range[1] ? current : range)
    }
    const onOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && (wrapperRef.current?.contains(event.target) || pinRef.current?.contains(event.target))) return
      setPendingRanges((current) => current.length > 0 ? [] : current)
      setKeepPick(null)
      clearSelectionIn(wrapperRef.current)
    }
    const onPointerEnd = (event: PointerEvent): void => {
      if (selectingPointer.current !== event.pointerId) return
      selectingPointer.current = null
      setSelecting(false)
      if (event.type !== 'pointerup' || !event.ctrlKey) return
      const wrapper = wrapperRef.current
      const selection = window.getSelection()
      const range = wrapper && selection && selectionRange(wrapper, selection)
      if (!range) return
      onSelection()
      setPendingRanges((current) => mergeRanges(current, range))
    }
    document.addEventListener('selectionchange', onSelection)
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('pointerup', onPointerEnd, true)
    document.addEventListener('pointercancel', onPointerEnd, true)
    return () => {
      document.removeEventListener('selectionchange', onSelection)
      document.removeEventListener('pointerdown', onOutside, true)
      document.removeEventListener('pointerup', onPointerEnd, true)
      document.removeEventListener('pointercancel', onPointerEnd, true)
    }
  }, [pendingRanges.length])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || pendingRanges.length === 0) return
    const selected = pendingRanges.flatMap((range) => {
      const native = domRange(wrapper, range)
      return native ? [native] : []
    })
    const highlight = new Highlight(...selected)
    CSS.highlights.set('ai-pending-keep', highlight)
    return () => {
      if (CSS.highlights.get('ai-pending-keep') === highlight) CSS.highlights.delete('ai-pending-keep')
    }
  }, [pendingRanges, keptRanges, collapsed])

  const keep = (range: KeepRange): void => {
    onChange(serializeRanges(mergeRanges([...ranges, ...pendingRanges], range)))
    setPendingRanges([])
    setKeepPick(null)
    setRemovePick(null)
    onKeep()
    window.getSelection()?.removeAllRanges()
  }

  const showRemove = (index: number, element: HTMLElement): void => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const rect = element.getBoundingClientRect()
    const base = wrapper.getBoundingClientRect()
    setRemovePick({
      index,
      left: Math.max(0, Math.min(rect.left - base.left, base.width - 52)),
      top: rect.bottom - base.top + 2,
    })
  }

  const onWrapperKey = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === 'Escape') {
      selectingPointer.current = null
      setSelecting(false)
      setPendingRanges([])
      setKeepPick(null)
      setRemovePick(null)
      window.getSelection()?.removeAllRanges()
      return
    }
    if (event.key !== 'Enter' || !keepPick) return
    if (event.target instanceof Element && event.target.closest('button')) return
    event.preventDefault()
    event.stopPropagation()
    keep(keepPick)
  }

  const segments = displaySegments(text, ranges)
  return (
    <span
      ref={wrapperRef}
      className="ai-keep nodrag nopan"
      tabIndex={!expanded && ranges.length === 0 ? -1 : 0}
      data-keep-text=""
      data-keep-state={collapsed ? 'kept' : 'full'}
      data-pending-count={pendingRanges.length || undefined}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target instanceof Element && event.target.closest('button')) return
        if (event.button !== 0) return
        selectingPointer.current = event.pointerId
        setSelecting(true)
        if (!event.ctrlKey) setPendingRanges((current) => current.length > 0 ? [] : current)
        setRemovePick(null)
      }}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseLeave={() => setRemovePick(null)}
      onBlurCapture={(event) => {
        const target = event.relatedTarget as Node | null
        if (event.currentTarget.contains(target) || (target && pinRef.current?.contains(target))) return
        setPendingRanges((current) => current.length > 0 ? [] : current)
        setKeepPick(null)
        setRemovePick(null)
        if (target) clearSelectionIn(event.currentTarget)
      }}
      onKeyDownCapture={onWrapperKey}
    >
      <span className="ai-keep-text">
        {segments.map((segment, index) => {
          if (segment.kind === 'ellipsis') {
            return collapsed ? (
              <span key={index} className="ai-keep-ellipsis" data-ellipsis="" data-keep-ellipsis="" aria-hidden="true">
                …
              </span>
            ) : null
          }
          if (segment.kind === 'kept') {
            const position = segments.slice(0, index).filter((item) => item.kind === 'kept').length
            return (
              <mark
                key={index}
                className="ai-kept"
                data-offset={segment.start}
                data-kept-range={position}
                tabIndex={0}
                role="button"
                aria-label={`Remove kept text: ${segment.text}`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (event.ctrlKey || !window.getSelection()?.isCollapsed) return
                  showRemove(position, event.currentTarget)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  showRemove(position, event.currentTarget)
                }}
              >
                {segment.text}
              </mark>
            )
          }
          return (
            <span key={index} data-offset={segment.start} className={collapsed ? 'sr-only' : undefined}>
              {segment.text}
            </span>
          )
        })}
      </span>
      {keepPick && toolbar ? createPortal(
        <button
          ref={pinRef}
          type="button"
          className="ai-tool ai-keep-pin"
          aria-label="Keep selected text"
          title={pendingRanges.length > 1 ? `Keep ${pendingRanges.length} selected phrases` : 'Keep selected text'}
          data-keep-pin=""
          data-keep-count={pendingRanges.length || 1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => keep(keepPick)}
        >
          <Pin size={12} />
        </button>,
        toolbar,
      ) : null}
      {removePick ? (
        <button
          type="button"
          className="ai-keep-label"
          data-remove-label=""
          style={{ left: removePick.left, top: removePick.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange(serializeRanges(removeRange(ranges, removePick.index)))
            setRemovePick(null)
          }}
        >
          Remove
        </button>
      ) : null}
    </span>
  )
}