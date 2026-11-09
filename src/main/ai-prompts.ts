import type { AiComment, AiReply } from '@shared/ai-comments'
import type { Task } from '@shared/types'
import type { ChatMessage } from './lm-studio'

export const MAX_ANCESTORS = 5
export const MAX_DAY_TASKS = 30
export const MAX_DAY_CHARS = 2000

export const COMMENT_SYSTEM_PROMPT = `You are a quiet margin companion in a personal daily notebook.
You read one task the person is writing and, only when you have something genuinely useful, leave a short margin comment.
Rules:
- Never rewrite, correct inside, or add to the person's task text. You only write margin comments.
- At most 30 words. One sentence is usually enough.
- Write in the same language as the task.
- Ask a gentle question, offer a brief observation, or point out a concrete inconsistency. No praise, no pep talk, no therapy.
- Most tasks need no comment. When in doubt, return null.
Respond with only a JSON object: {"comment": string or null, "type": "question" | "remark" | "correction"}.
When comment is null, type may be "remark".`

export const REPLY_SYSTEM_PROMPT = `You are a quiet margin companion in a personal daily notebook, replying to the person's answer to your earlier margin comment.
Rules:
- Never rewrite or edit the person's task text. You only write margin replies.
- At most 40 words. Same language as the person's reply.
- Be concrete and calm. No praise, no pep talk.
Respond with only a JSON object: {"reply": string}.`

export const COMMENT_SCHEMA = {
  name: 'margin_comment',
  schema: {
    type: 'object',
    properties: {
      comment: { type: ['string', 'null'] },
      type: { type: 'string', enum: ['question', 'remark', 'correction'] },
    },
    required: ['comment', 'type'],
    additionalProperties: false,
  },
}

export const REPLY_SCHEMA = {
  name: 'margin_reply',
  schema: {
    type: 'object',
    properties: { reply: { type: 'string' } },
    required: ['reply'],
    additionalProperties: false,
  },
}

function lineageLines(task: Task, ancestors: Task[]): string[] {
  const chain = ancestors.slice(0, MAX_ANCESTORS).reverse()
  chain.push(task)
  return chain.map((item, index) => {
    const label = index === chain.length - 1 ? 'Current task' : `Earlier line ${index + 1}`
    return `${label}: ${item.text}`
  })
}

function dayLines(task: Task, dayTasks: Task[]): string[] {
  const lines: string[] = []
  let chars = 0
  let count = 0
  for (const item of dayTasks) {
    if (count >= MAX_DAY_TASKS || chars >= MAX_DAY_CHARS) break
    if (item.id === task.id || item.side !== 'main') continue
    const line = `- ${item.done ? '(done) ' : ''}${item.text}`
    if (chars + line.length > MAX_DAY_CHARS) break
    lines.push(line)
    chars += line.length
    count += 1
  }
  return lines
}

export function buildCommentMessages(task: Task, ancestors: Task[], dayTasks: Task[]): ChatMessage[] {
  const parts = [...lineageLines(task, ancestors)]
  const day = dayLines(task, dayTasks)
  if (day.length > 0) parts.push('Other tasks today:', ...day)
  return [
    { role: 'system', content: COMMENT_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ]
}

export function buildReplyMessages(
  task: Task,
  comment: AiComment,
  newReply: string,
): ChatMessage[] {
  const parts = [`Task: ${task.text}`, `Your earlier comment: ${comment.text}`]
  const history: AiReply[] = comment.replies.slice(-10)
  for (const reply of history) {
    parts.push(`${reply.role === 'user' ? 'Person' : 'You'}: ${reply.text}`)
  }
  parts.push(`Person: ${newReply}`)
  return [
    { role: 'system', content: REPLY_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ]
}