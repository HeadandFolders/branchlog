import { randomUUID } from 'node:crypto'
import type {
  AiComment,
  AiCommentResult,
  AiReply,
  AiReplyResult,
  CommentReplyInput,
  CommentRequest,
} from '@shared/ai-comments'
import type { Task } from '@shared/types'
import { readAiSettings } from './ai-settings-store'
import { parseCommentJson, parseReplyJson } from './ai-parse'
import { buildCommentMessages, buildReplyMessages, COMMENT_SCHEMA, MAX_ANCESTORS, REPLY_SCHEMA } from './ai-prompts'
import { addReplies, countCommentsOn, getComment, insertComment } from './ai-store'
import { getTask, listTasksByDate } from './database'
import { requestChat } from './lm-studio'

interface Flight {
  requestId: string
  controller: AbortController
}

let autoFlight: Flight | null = null
let replyFlight: Flight | null = null

function eligible(task: Task | undefined, text: string): task is Task {
  return Boolean(
    task && task.side === 'main' && !task.done && task.droppedAt === null && task.text === text,
  )
}

function ancestorsOf(task: Task): Task[] {
  const chain: Task[] = []
  let parentId = task.parentId
  while (parentId && chain.length < MAX_ANCESTORS) {
    const parent = getTask(parentId)
    if (!parent) break
    chain.push(parent)
    parentId = parent.parentId
  }
  return chain
}

export async function requestComment(input: CommentRequest): Promise<AiCommentResult> {
  const settings = readAiSettings()
  if (!settings.enabled) return { kind: 'none' }
  const task = getTask(input.taskId)
  if (!eligible(task, input.text)) return { kind: 'none' }
  if (countCommentsOn(task.dateCreated) >= settings.maxCommentsPerDay) return { kind: 'none' }

  autoFlight?.controller.abort()
  const controller = new AbortController()
  autoFlight = { requestId: input.requestId, controller }
  const messages = buildCommentMessages(task, ancestorsOf(task), listTasksByDate(task.dateCreated))
  const reply = await requestChat({
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages,
    schema: COMMENT_SCHEMA,
    signal: controller.signal,
  })
  if (autoFlight?.requestId !== input.requestId) return { kind: 'none' }
  autoFlight = null
  if (!reply.ok) return reply.badAnswer ? { kind: 'none' } : { kind: 'offline' }
  if (!('json' in reply)) return { kind: 'none' }
  const parsed = parseCommentJson(reply.json)
  if (!parsed) return { kind: 'none' }
  if (!readAiSettings().enabled || !eligible(getTask(input.taskId), input.text)) return { kind: 'none' }

  const comment: AiComment = {
    id: randomUUID(),
    taskId: task.id,
    side: 'left',
    type: parsed.type,
    text: parsed.text,
    status: 'open',
    keptRanges: '[]',
    x: input.x,
    y: input.y,
    createdAt: new Date().toISOString(),
    replies: [],
  }
  insertComment(comment)
  return { kind: 'comment', comment }
}

export async function replyToComment(input: CommentReplyInput): Promise<AiReplyResult> {
  const settings = readAiSettings()
  if (!settings.enabled) return { kind: 'none' }
  const comment = getComment(input.commentId)
  if (!comment) return { kind: 'none' }
  const task = getTask(comment.taskId)
  if (!task) return { kind: 'none' }

  replyFlight?.controller.abort()
  const controller = new AbortController()
  replyFlight = { requestId: input.requestId, controller }
  const reply = await requestChat({
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages: buildReplyMessages(task, comment, input.text),
    schema: REPLY_SCHEMA,
    signal: controller.signal,
  })
  if (replyFlight?.requestId !== input.requestId) return { kind: 'none' }
  replyFlight = null
  if (!reply.ok) return reply.badAnswer ? { kind: 'none' } : { kind: 'offline' }
  if (!('json' in reply)) return { kind: 'none' }
  const text = parseReplyJson(reply.json)
  if (text === null) return { kind: 'none' }
  if (!getComment(input.commentId)) return { kind: 'none' }

  const createdAt = new Date().toISOString()
  const userReply: AiReply = {
    id: randomUUID(),
    commentId: comment.id,
    role: 'user',
    text: input.text,
    keptRanges: '[]',
    createdAt,
  }
  const aiReply: AiReply = {
    id: randomUUID(),
    commentId: comment.id,
    role: 'ai',
    text,
    keptRanges: '[]',
    createdAt,
  }
  addReplies(comment.id, [userReply, aiReply])
  const updated = getComment(comment.id)
  if (!updated) return { kind: 'none' }
  return { kind: 'replied', comment: updated }
}

export function cancelAiFlights(): void {
  autoFlight?.controller.abort()
  autoFlight = null
  replyFlight?.controller.abort()
  replyFlight = null
}