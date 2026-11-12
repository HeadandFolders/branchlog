import { normalizeBriefName } from './ai-briefs'
import { listBriefRefs } from './brief-refs'

// A held row asks a question instead of spending a request, so three of them is already a wall of
// questions. Anything past the third is left alone.
export const MAX_HOLDS_PER_DAY = 3

// Only the briefs a person could actually pick here make a hold worth asking for: an always-include
// brief is in every prompt anyway, and a disabled brief answers nothing.
export interface AttributionBrief {
  id: string
  name: string
  summary: string
  enabled: boolean
  alwaysInclude: boolean
}

// What the user chose on this row's own comment chip. It outranks a keyword guess and is never
// overwritten, including the choice of no project at all — which is why the id may be null.
export interface ProjectCorrection {
  projectId: string | null
}

export interface AttributionInput {
  text: string
  projectId: string | null
  briefs: readonly AttributionBrief[]
  dayNote: string
  holdDismissed?: boolean
  correction?: ProjectCorrection | null
}

// Where a run's project came from. A correction is the only one the person chose themselves, so it is
// the only one that pins the label and outranks every later guess.
export type AttributionSource = 'bound' | 'correction' | 'auto' | 'none'

export type Attribution =
  | { kind: 'run'; briefId: string | null; source: AttributionSource }
  | { kind: 'hold' }

const MIN_KEYWORD_CHARS = 3

// Matching is by whole word, so these are the words every summary carries and no task means.
const STOP_KEYWORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'into',
  'onto',
  'this',
  'that',
  'these',
  'those',
  'then',
  'than',
  'when',
  'will',
  'would',
  'could',
  'should',
  'must',
  'not',
  'but',
  'all',
  'any',
  'are',
  'was',
  'were',
  'have',
  'has',
  'had',
  'been',
  'being',
  'does',
  'did',
  'can',
  'may',
  'our',
  'your',
  'them',
  'their',
  'about',
  'after',
  'before',
  'above',
  'below',
  'over',
  'under',
  'more',
  'most',
  'other',
  'another',
  'some',
  'such',
  'only',
  'very',
  'each',
  'every',
  'which',
  'what',
  'who',
  'how',
  'where',
  'also',
  'just',
  'still',
  'while',
  'because',
  'until',
  'since',
  'during',
  'without',
  'within',
  'upon',
])

function keywords(text: string): Set<string> {
  const found = new Set<string>()
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < MIN_KEYWORD_CHARS || STOP_KEYWORDS.has(word)) continue
    found.add(word)
  }
  return found
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const word of b) {
    if (a.has(word)) return true
  }
  return false
}

// Summaries only, never the brief file: the body is read for the prompt, and matching it against the
// row would answer for tasks that merely share a word with a long document.
function briefKeywords(brief: AttributionBrief): Set<string> {
  return new Set([...keywords(brief.name), ...keywords(brief.summary)])
}

function enabledBriefs(briefs: readonly AttributionBrief[]): AttributionBrief[] {
  return briefs.filter((brief) => brief.enabled)
}

// A day note belongs to the date, not to a row, and its references cover every row that day. So a
// note that already names a brief answers the question the hold would ask.
export function dayNoteBriefIds(dayNote: string, briefs: readonly AttributionBrief[]): string[] {
  const note = dayNote.trim()
  if (note === '') return []
  const candidates = enabledBriefs(briefs)
  const byName = new Map(candidates.map((brief) => [normalizeBriefName(brief.name), brief.id]))
  const ids: string[] = []
  for (const ref of listBriefRefs(note, candidates.map((brief) => brief.name))) {
    const id = byName.get(normalizeBriefName(ref.name))
    if (id !== undefined && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export function pickableBriefs(briefs: readonly AttributionBrief[]): AttributionBrief[] {
  return briefs.filter((brief) => brief.enabled && !brief.alwaysInclude)
}

export function attributeTask(input: AttributionInput): Attribution {
  // A row that already says which project it belongs to is not a question waiting to be asked.
  if (input.projectId !== null) return { kind: 'run', briefId: input.projectId, source: 'bound' }
  if (input.correction !== undefined && input.correction !== null) {
    return { kind: 'run', briefId: input.correction.projectId, source: 'correction' }
  }

  const choices = pickableBriefs(input.briefs)
  if (choices.length === 0) return { kind: 'run', briefId: null, source: 'none' }
  if (dayNoteBriefIds(input.dayNote, input.briefs).length > 0) {
    return { kind: 'run', briefId: null, source: 'none' }
  }

  const words = keywords(input.text)
  const matched = choices.filter((brief) => overlaps(words, briefKeywords(brief)))
  if (matched.length === 1) return { kind: 'run', briefId: matched[0].id, source: 'auto' }

  // Nothing was said, or two briefs were: only the person knows which one, and the row already said
  // so once by letting the question go.
  if (input.holdDismissed === true) return { kind: 'run', briefId: null, source: 'none' }
  return { kind: 'hold' }
}
