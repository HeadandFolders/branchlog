import {
  isAiCommentType,
  parseKeptRanges,
  type AiComment,
  type AiCommentStatus,
  type AiReply,
  type AskAiInput,
  type CommentReplyInput,
  type CommentRequest,
  type KeptRangesInput,
  type RemovedComments,
} from '@shared/ai-comments'
import { requireCoordinate, requireDateKey, requireId, requireRecord, requireText } from './validate'

export function parseCommentRequest(value: unknown): CommentRequest {
  const input = requireRecord(value)
  return {
    taskId: requireId(input.taskId),
    requestId: requireId(input.requestId),
    text: requireText(input.text),
    x: requireCoordinate(input.x),
    y: requireCoordinate(input.y),
  }
}

export function parseAskAiInput(value: unknown): AskAiInput {
  const input = requireRecord(value)
  const text = requireText(input.text)
  if (text.trim() === '') throw new Error('Invalid text')
  return {
    taskId: requireId(input.taskId),
    requestId: requireId(input.requestId),
    text,
  }
}

export function parseAiCancel(value: unknown): string {
  return requireId(value)
}

export function parseCommentReply(value: unknown): CommentReplyInput {
  const input = requireRecord(value)
  const text = requireText(input.text)
  if (text.trim() === '') throw new Error('Invalid text')
  return {
    commentId: requireId(input.commentId),
    requestId: requireId(input.requestId),
    text,
  }
}

export function parseCommentStatus(value: unknown): { id: string; status: AiCommentStatus } {
  const input = requireRecord(value)
  if (input.status !== 'open' && input.status !== 'resolved') throw new Error('Invalid comment')
  return { id: requireId(input.id), status: input.status }
}

export function parseKeptRangesInput(value: unknown): KeptRangesInput {
  const input = requireRecord(value)
  const commentId = requireId(input.commentId)
  const replyId = input.replyId === null ? null : requireId(input.replyId)
  const keptRanges = parseKeptRanges(input.keptRanges)
  const ranges = JSON.parse(keptRanges) as [number, number][]
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start < cursor || end <= start) throw new Error('Invalid comment')
    cursor = end
  }
  return { commentId, replyId, keptRanges }
}

function parseCreatedAt(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40 || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid comment')
  }
  return value
}

function parseReply(value: unknown, commentId: string): AiReply {
  const input = requireRecord(value)
  if (requireId(input.commentId) !== commentId) throw new Error('Invalid comment')
  if (input.role !== 'user' && input.role !== 'ai') throw new Error('Invalid comment')
  return {
    id: requireId(input.id),
    commentId,
    role: input.role,
    text: requireText(input.text),
    keptRanges: parseKeptRanges(input.keptRanges),
    createdAt: parseCreatedAt(input.createdAt),
  }
}

function parseComment(value: unknown): AiComment {
  const input = requireRecord(value)
  const id = requireId(input.id)
  if (input.side !== 'left' && input.side !== 'right') throw new Error('Invalid comment')
  if (!isAiCommentType(input.type)) throw new Error('Invalid comment')
  if (input.status !== 'open' && input.status !== 'resolved') throw new Error('Invalid comment')
  if (!Array.isArray(input.replies) || input.replies.length > 500) throw new Error('Invalid comment')
  const replies = input.replies.map((reply) => parseReply(reply, id))
  if (new Set(replies.map((reply) => reply.id)).size !== replies.length) throw new Error('Invalid comment')
  return {
    id,
    taskId: requireId(input.taskId),
    side: input.side,
    type: input.type,
    text: requireText(input.text),
    status: input.status,
    keptRanges: parseKeptRanges(input.keptRanges),
    x: requireCoordinate(input.x),
    y: requireCoordinate(input.y),
    createdAt: parseCreatedAt(input.createdAt),
    replies,
  }
}

export function parseRemovedComments(value: unknown): RemovedComments {
  const input = requireRecord(value)
  if (!Array.isArray(input.comments) || input.comments.length === 0 || input.comments.length > 5_000) {
    throw new Error('Invalid comment')
  }
  const comments = input.comments.map(parseComment)
  if (new Set(comments.map((comment) => comment.id)).size !== comments.length) throw new Error('Invalid comment')
  return { comments }
}

export function parseCommentReplace(value: unknown): { date: string; comments: AiComment[] } {
  const input = requireRecord(value)
  const date = requireDateKey(input.date)
  if (!Array.isArray(input.comments) || input.comments.length > 5_000) throw new Error('Invalid comment')
  const comments = input.comments.map(parseComment)
  if (new Set(comments.map((comment) => comment.id)).size !== comments.length) throw new Error('Invalid comment')
  return { date, comments }
}