import { normalizeBriefName, RESERVED_BRIEF_NAME } from './ai-briefs'

// An '@' preceded by one of these sits inside something else already being typed — an email address,
// a handle, a version — so it opens no reference.
const LOCAL_PART_CHAR = /[A-Za-z0-9._%+-]/
// The character after a name has to fall outside this set, so '@api' never answers for '@apikey'.
const NAME_CHAR = /[A-Za-z0-9_]/
// What a person may still be typing between the '@' and the caret. A space stays inside the query so
// a two-word brief name can be completed; '@' cannot, so '@alpha @' starts a fresh query.
const QUERY_CHAR = /[A-Za-z0-9_ .+-]/

export interface BriefRef {
  name: string
  start: number
  end: number
}

export interface RefQuery {
  start: number
  end: number
  query: string
}

// Names are matched case-insensitively and longest first, so a longer brief that starts like a shorter
// one takes the text it deserves. Ties break on the name so two runs over the same list agree.
function byLongestFirst(names: readonly string[]): string[] {
  return [...new Set(names)].sort((a, b) => b.length - a.length || compareNormalized(a, b))
}

function compareNormalized(a: string, b: string): number {
  const left = normalizeBriefName(a)
  const right = normalizeBriefName(b)
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function matchable(names: readonly string[]): string[] {
  return byLongestFirst(names).filter((name) => normalizeBriefName(name) !== RESERVED_BRIEF_NAME)
}

function startsAt(text: string, index: number, name: string): boolean {
  if (name === '') return false
  const left = normalizeBriefName(text.slice(index, index + name.length))
  if (left !== normalizeBriefName(name)) return false
  return !NAME_CHAR.test(text.charAt(index + name.length))
}

// Scanning stops past a name once it matches, so an '@' living inside a matched name opens no second
// reference.
export function listBriefRefs(text: string, names: readonly string[]): BriefRef[] {
  const candidates = matchable(names)
  if (candidates.length === 0 || text === '') return []
  const found: BriefRef[] = []
  const seen = new Set<string>()
  let index = 0
  while (index < text.length) {
    const at = text.indexOf('@', index)
    if (at < 0) break
    const hit = LOCAL_PART_CHAR.test(text.charAt(at - 1))
      ? undefined
      : candidates.find((name) => startsAt(text, at + 1, name))
    if (hit) {
      const key = normalizeBriefName(hit)
      if (!seen.has(key)) {
        seen.add(key)
        found.push({ name: hit, start: at, end: at + 1 + hit.length })
      }
      index = at + 1 + hit.length
    } else {
      index = at + 1
    }
  }
  return found
}

// The most recently typed reference is the one the person means, so the last match in the row wins.
export function matchBriefRef(text: string, names: readonly string[]): BriefRef | null {
  return listBriefRefs(text, names).at(-1) ?? null
}

// The query under the caret: an '@' that is not buried inside other text, with nothing but reference
// characters between it and the caret, and the caret at the end of the token being typed. A caret
// parked mid-word offers nothing, because completing there would cut the word in half.
export function refQueryAt(text: string, caret: number): RefQuery | null {
  const end = Math.max(0, Math.min(caret, text.length))
  const start = text.slice(0, end).lastIndexOf('@')
  if (start < 0) return null
  if (LOCAL_PART_CHAR.test(text.charAt(start - 1))) return null
  const body = text.slice(start + 1, end)
  if (body !== '' && !QUERY_CHAR.test(body)) return null
  if (NAME_CHAR.test(text.charAt(end))) return null
  return { start, end, query: normalizeBriefName(body) }
}

export type RefCandidateKind = 'request' | 'brief'

export interface RefCandidate {
  kind: RefCandidateKind
  name: string
}

export const REQUEST_REF: RefCandidate = { kind: 'request', name: RESERVED_BRIEF_NAME }

// The request row is the thing a person types most often by marker, and '@r' can never be a brief, so
// it leads the list; briefs follow in name order, which is how the panel lists them too.
export function refCandidates(query: string, names: readonly string[]): RefCandidate[] {
  const briefs = matchable(names)
    .filter((name) => normalizeBriefName(name).startsWith(query))
    .sort(compareNormalized)
    .map((name) => ({ kind: 'brief' as const, name }))
  return normalizeBriefName(RESERVED_BRIEF_NAME).startsWith(query) ? [REQUEST_REF, ...briefs] : briefs
}

export function applyRefAccept(text: string, query: RefQuery, name: string): { text: string; caret: number } {
  const gap = text.charAt(query.end) === ' ' ? '' : ' '
  const insert = `@${name}${gap}`
  const next = text.slice(0, query.start) + insert + text.slice(query.end)
  return { text: next, caret: query.start + insert.length }
}

// A pick from outside the field has no caret to complete at, so the reference joins the end of the row
// with one space — nothing the person typed is rewritten, which is what makes the bind undoable.
export function appendBriefRef(text: string, name: string): string {
  if (text === '' || /\s$/.test(text)) return `${text}@${name}`
  return `${text} @${name}`
}
