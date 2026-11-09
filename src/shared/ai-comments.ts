export type AiCommentType = 'question' | 'remark' | 'correction'
export type AiCommentStatus = 'open' | 'resolved'

export interface AiReply {
  id: string
  commentId: string
  role: 'user' | 'ai'
  text: string
  keptRanges: string
  createdAt: string
}

export interface AiComment {
  id: string
  taskId: string
  side: 'left'
  type: AiCommentType
  text: string
  status: AiCommentStatus
  keptRanges: string
  x: number
  y: number
  createdAt: string
  replies: AiReply[]
}

export interface CommentRequest {
  taskId: string
  requestId: string
  text: string
  x: number
  y: number
}

export interface CommentReplyInput {
  commentId: string
  requestId: string
  text: string
}

export interface RemovedComments {
  comments: AiComment[]
}

export type AiCommentResult =
  | { kind: 'comment'; comment: AiComment }
  | { kind: 'none' }
  | { kind: 'offline' }

export type AiReplyResult =
  | { kind: 'replied'; comment: AiComment }
  | { kind: 'none' }
  | { kind: 'offline' }

export type AiCommentWriteResult = { ok: true; comment: AiComment } | { ok: false }

export type AiCommentDeleteResult = { ok: true; removed: RemovedComments } | { ok: false }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAiCommentType(value: unknown): value is AiCommentType {
  return value === 'question' || value === 'remark' || value === 'correction'
}

export function parseKeptRanges(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4_000) throw new Error('Invalid comment')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Invalid comment')
  }
  if (!Array.isArray(parsed) || parsed.length > 200) throw new Error('Invalid comment')
  for (const range of parsed) {
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Number.isInteger(range[0]) ||
      !Number.isInteger(range[1]) ||
      (range[0] as number) < 0 ||
      (range[1] as number) < (range[0] as number)
    ) {
      throw new Error('Invalid comment')
    }
  }
  return value
}

export function isAiReply(value: unknown): value is AiReply {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.commentId === 'string' &&
    (value.role === 'user' || value.role === 'ai') &&
    typeof value.text === 'string' &&
    typeof value.keptRanges === 'string' &&
    typeof value.createdAt === 'string'
  )
}

export function isAiComment(value: unknown): value is AiComment {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.taskId === 'string' &&
    value.side === 'left' &&
    isAiCommentType(value.type) &&
    typeof value.text === 'string' &&
    (value.status === 'open' || value.status === 'resolved') &&
    typeof value.keptRanges === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.replies) &&
    value.replies.every(isAiReply)
  )
}

export function isAiCommentList(value: unknown): value is AiComment[] {
  return Array.isArray(value) && value.every(isAiComment)
}

export function isRemovedComments(value: unknown): value is RemovedComments {
  return isRecord(value) && isAiCommentList(value.comments)
}

export function isAiCommentResult(value: unknown): value is AiCommentResult {
  if (!isRecord(value)) return false
  if (value.kind === 'none' || value.kind === 'offline') return true
  return value.kind === 'comment' && isAiComment(value.comment)
}

export function isAiReplyResult(value: unknown): value is AiReplyResult {
  if (!isRecord(value)) return false
  if (value.kind === 'none' || value.kind === 'offline') return true
  return value.kind === 'replied' && isAiComment(value.comment)
}

export function isAiCommentWriteResult(value: unknown): value is AiCommentWriteResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === false) return true
  return isAiComment(value.comment)
}

export function isAiCommentDeleteResult(value: unknown): value is AiCommentDeleteResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok === false) return true
  return isRemovedComments(value.removed)
}