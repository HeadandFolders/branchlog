import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import {
  clampRanges,
  displaySegments,
  mergeRanges,
  parseRanges,
  removeRange,
  serializeRanges,
  type KeepRange,
} from '../lib/keep-ranges'
import { selectionRange } from '../lib/keep-selection'

interface KeepPick {
  range: KeepRange
  left: number
  top: number
}

interface RemovePick {
  index: number
  left: number
  top: number
}

interface KeepHideTextProps {
  text: string
  keptRanges: string
  onChange: (keptRanges: string) => void
}

export function KeepHideText({ text, keptRanges, onChange }: KeepHideTextProps): ReactElement {
  const ranges = clampRanges(parseRanges(keptRanges), text.length)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  const [keyFocus, setKeyFocus] = useState(false)
  const [keepPick, setKeepPick] = useState<KeepPick | null>(null)
  const [removePick, setRemovePick] = useState<RemovePick | null>(null)
  const collapsed = ranges.length > 0 && !hover && !keyFocus

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
        setKeepPick(null)
        return
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      const base = wrapper.getBoundingClientRect()
      setKeepPick({
        range,
        left: Math.max(0, Math.min(rect.right - base.left, base.width - 34)),
        top: rect.top - base.top - 18,
      })
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [])

  const keep = (range: KeepRange): void => {
    onChange(serializeRanges(mergeRanges(ranges, range)))
    setKeepPick(null)
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
      setKeepPick(null)
      setRemovePick(null)
      return
    }
    if (event.key !== 'Enter' || event.target !== event.currentTarget || !keepPick) return
    event.preventDefault()
    event.stopPropagation()
    keep(keepPick.range)
  }

  const segments = displaySegments(text, ranges)
  return (
    <span
      ref={wrapperRef}
      className="ai-keep nodrag"
      tabIndex={0}
      data-keep-text=""
      data-keep-state={collapsed ? 'kept' : 'full'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setRemovePick(null)
      }}
      onFocusCapture={(event) => {
        if (event.target instanceof Element && event.target.matches(':focus-visible')) setKeyFocus(true)
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyFocus(false)
      }}
      onKeyDown={onWrapperKey}
    >
      <span key={collapsed ? 'kept' : 'full'} className="ai-keep-text">
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
      {keepPick ? (
        <button
          type="button"
          className="ai-keep-label"
          data-keep-label=""
          style={{ left: keepPick.left, top: keepPick.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => keep(keepPick.range)}
        >
          Keep
        </button>
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