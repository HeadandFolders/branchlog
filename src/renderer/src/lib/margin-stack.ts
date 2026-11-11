import type { AiComment } from '@shared/ai-comments'
import { parseRanges } from './keep-ranges'

// The margin box is measured by React Flow once it has painted. These numbers are the
// same box read off the stylesheet, so a comment can be laid out in the frame before
// that measurement lands and a saved notebook can be checked on load.
export const AI_COMMENT_LINE_HEIGHT = 20
export const AI_COMMENT_EDGE_HEIGHT = 4
export const AI_COMMENT_FORM_HEIGHT = 25
export const AI_COMMENT_TOOLS_HEIGHT = 19
export const AI_COMMENT_THREAD_HEIGHT = 6
export const AI_COMMENT_REPLY_HEIGHT = 22
export const AI_COMMENT_DOT_HEIGHT = 24
export const MAX_FULL_COMMENTS_PER_TASK = 2

const CHARS_PER_LINE = 32

function wrappedLines(text: string): number {
  let lines = 0
  for (const paragraph of text.split('\n')) lines += Math.max(1, Math.ceil(paragraph.length / CHARS_PER_LINE))
  return lines
}

function isTrimmed(text: string, keptRanges: string): boolean {
  return text !== '' && parseRanges(keptRanges).length > 0
}

// Chat stays hidden until it is asked for: a trimmed comment at rest reads as its kept
// phrases alone, with the reply thread, the write-back field and the tool links folded
// away. That is what AiCommentBody's data-ai-expanded already reports about itself.
function isQuiet(comment: AiComment): boolean {
  const replies = comment.replies.some((reply) => isTrimmed(reply.text, reply.keptRanges))
  return isTrimmed(comment.text, comment.keptRanges) || replies
}

export function estimateCommentHeight(comment: AiComment, collapsed: boolean): number {
  if (collapsed) return AI_COMMENT_DOT_HEIGHT
  const quiet = isQuiet(comment)
  const lines = quiet ? 1 : wrappedLines(comment.text)
  const height = AI_COMMENT_EDGE_HEIGHT + lines * AI_COMMENT_LINE_HEIGHT
  if (quiet) return height
  const thread = comment.replies.length
  const replies = thread > 0 ? AI_COMMENT_THREAD_HEIGHT + thread * AI_COMMENT_REPLY_HEIGHT : 0
  return height + replies + AI_COMMENT_FORM_HEIGHT + AI_COMMENT_TOOLS_HEIGHT
}

function byCreation(a: AiComment, b: AiComment): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
}

// Newest first within a task, tasks in the order their lines run down the page.
function byTask(comments: readonly AiComment[]): Map<string, AiComment[]> {
  const grouped = new Map<string, AiComment[]>()
  for (const comment of comments) {
    if (comment.side !== 'left' || comment.status !== 'open') continue
    const list = grouped.get(comment.taskId)
    if (list) list.push(comment)
    else grouped.set(comment.taskId, [comment])
  }
  for (const list of grouped.values()) list.sort(byCreation)
  return grouped
}

let shapes: readonly AiComment[] | null = null
let shownCache: ReadonlySet<string> | null = null
let collapsedCache: ReadonlySet<string> = new Set()

// One owner for the calm-margin rule: the newest two comments on a task read as text,
// the older ones wait as dots so a busy task cannot bury its own margin.
export function collapsedComments(comments: readonly AiComment[], shown: ReadonlySet<string>): ReadonlySet<string> {
  if (comments === shapes && shown === shownCache) return collapsedCache
  shapes = comments
  shownCache = shown
  const collapsed = new Set<string>()
  for (const list of byTask(comments).values()) {
    for (const comment of list.slice(MAX_FULL_COMMENTS_PER_TASK)) {
      if (!shown.has(comment.id)) collapsed.add(comment.id)
    }
  }
  collapsedCache = collapsed
  return collapsed
}

export function marginComments(comments: readonly AiComment[]): AiComment[] {
  const out: AiComment[] = []
  for (const list of byTask(comments).values()) out.push(...list)
  return out
}

// The rank a comment holds on its own task line: 0 is the newest, the one that stays
// on the line while everything older gives way below it.
export function marginHold(comments: readonly AiComment[]): Map<string, number> {
  const hold = new Map<string, number>()
  for (const list of byTask(comments).values()) {
    list.forEach((comment, index) => hold.set(comment.id, index))
  }
  return hold
}
