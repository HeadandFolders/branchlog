import { isAiCommentType, type AiCommentType } from '@shared/ai-comments'

const MAX_COMMENT_CHARS = 500
const MAX_REPLY_CHARS = 2_000
const MAX_ANSWER_CHARS = 2_000

export interface ParsedComment {
  text: string
  type: AiCommentType
}

export function parseCommentJson(json: unknown): ParsedComment | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const record = json as { comment?: unknown; type?: unknown }
  if (typeof record.comment !== 'string') return null
  const text = record.comment.trim()
  if (text === '' || text.length > MAX_COMMENT_CHARS) return null
  const type = isAiCommentType(record.type) ? record.type : 'remark'
  return { text, type }
}

export function parseAnswerJson(json: unknown): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const answer = (json as { answer?: unknown }).answer
  if (typeof answer !== 'string') return null
  const text = answer.trim()
  if (text === '' || text.length > MAX_ANSWER_CHARS) return null
  return text
}

export function parseReplyJson(json: unknown): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const reply = (json as { reply?: unknown }).reply
  if (typeof reply !== 'string') return null
  const text = reply.trim()
  if (text === '' || text.length > MAX_REPLY_CHARS) return null
  return text
}