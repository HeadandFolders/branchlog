export type KeepRange = [number, number]

export interface DisplaySegment {
  kind: 'kept' | 'gap' | 'ellipsis'
  text: string
  start: number
}

export function parseRanges(json: string): KeepRange[] {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const ranges: KeepRange[] = []
  for (const item of value) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      !Number.isInteger(item[0]) ||
      !Number.isInteger(item[1]) ||
      (item[0] as number) < 0 ||
      (item[1] as number) <= (item[0] as number)
    ) {
      return []
    }
    ranges.push([item[0] as number, item[1] as number])
  }
  return mergeRanges(ranges, null)
}

export function serializeRanges(ranges: readonly KeepRange[]): string {
  return JSON.stringify(ranges)
}

export function mergeRanges(ranges: readonly KeepRange[], next: KeepRange | null): KeepRange[] {
  const all = next ? [...ranges, next] : [...ranges]
  all.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: KeepRange[] = []
  for (const range of all) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

export function removeRange(ranges: readonly KeepRange[], index: number): KeepRange[] {
  return ranges.filter((_, position) => position !== index)
}

export function clampRanges(ranges: readonly KeepRange[], length: number): KeepRange[] {
  const clamped: KeepRange[] = []
  for (const [start, end] of ranges) {
    const from = Math.max(0, Math.min(start, length))
    const to = Math.max(from, Math.min(end, length))
    if (to > from) clamped.push([from, to])
  }
  return mergeRanges(clamped, null)
}

export function displaySegments(text: string, ranges: readonly KeepRange[]): DisplaySegment[] {
  const segments: DisplaySegment[] = []
  let cursor = 0
  let first = true
  for (const [start, end] of ranges) {
    if (start > cursor) {
      segments.push({ kind: 'gap', text: text.slice(cursor, start), start: cursor })
      if (!first) segments.push({ kind: 'ellipsis', text: '…', start })
    }
    segments.push({ kind: 'kept', text: text.slice(start, end), start })
    cursor = end
    first = false
  }
  if (cursor < text.length) segments.push({ kind: 'gap', text: text.slice(cursor), start: cursor })
  return segments
}

export interface OffsetPiece {
  start: number
  length: number
}

export function rangeFromOffsets(
  pieces: readonly OffsetPiece[],
  anchorIndex: number,
  anchorOffset: number,
  focusIndex: number,
  focusOffset: number,
): KeepRange | null {
  const anchor = pieces[anchorIndex]
  const focus = pieces[focusIndex]
  if (!anchor || !focus) return null
  const from = anchor.start + Math.max(0, Math.min(anchorOffset, anchor.length))
  const to = focus.start + Math.max(0, Math.min(focusOffset, focus.length))
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  return end > start ? [start, end] : null
}