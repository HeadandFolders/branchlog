import { isAiCommentType, type AiCommentType } from '@shared/ai-comments'
import { DEFAULT_ANSWER_MAX_CHARS } from '@shared/ai-settings'

const MAX_COMMENT_CHARS = 500
const MAX_REPLY_CHARS = 2_000
const TRUNCATION_MARKER = ' [truncated]'

export interface ParsedComment {
  text: string
  type: AiCommentType
}

export type ProseKind = 'question' | 'deliverable'

export function parseCommentJson(json: unknown): ParsedComment | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const record = json as { comment?: unknown; type?: unknown }
  if (typeof record.comment !== 'string') return null
  const text = record.comment.trim()
  if (text === '' || text.length > MAX_COMMENT_CHARS) return null
  const type = isAiCommentType(record.type) ? record.type : 'remark'
  return { text, type }
}

// A long answer is still the answer. Cutting it says so; discarding it throws away the only work
// the model did, which on this hardware can cost minutes.
export function truncateToCharBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const budget = Math.max(0, maxChars - TRUNCATION_MARKER.length)
  const head = text.slice(0, budget)
  const boundary = lastSentenceEnd(head)
  const kept = (boundary > 0 ? head.slice(0, boundary) : head).trimEnd()
  return `${kept}${TRUNCATION_MARKER}`
}

function lastSentenceEnd(head: string): number {
  const boundary = /[.!?…]["')\]]?(?=\s|$)/g
  let end = -1
  let match: RegExpExecArray | null = boundary.exec(head)
  while (match !== null) {
    end = match.index + match[0].length
    match = boundary.exec(head)
  }
  return end
}

export function parseAnswerJson(json: unknown, maxChars = DEFAULT_ANSWER_MAX_CHARS): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const answer = (json as { answer?: unknown }).answer
  if (typeof answer !== 'string') return null
  const text = answer.trim()
  if (text === '') return null
  return truncateToCharBudget(text, maxChars)
}

export function parseReplyJson(json: unknown, maxChars = MAX_REPLY_CHARS): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const reply = (json as { reply?: unknown }).reply
  if (typeof reply !== 'string') return null
  const text = reply.trim()
  if (text === '') return null
  return truncateToCharBudget(text, maxChars)
}

// Prose has no schema to carry the intent, so a leading QUESTION: is the whole signal that the
// model is asking instead of handing over a deliverable.
export function classifyProse(text: string): { kind: ProseKind; text: string } {
  const trimmed = text.trim()
  const prefix = /^question\s*:/i.exec(trimmed)
  if (!prefix) return { kind: 'deliverable', text: trimmed }
  return { kind: 'question', text: trimmed.slice(prefix[0].length).trim() }
}
