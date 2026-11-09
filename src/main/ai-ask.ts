import { randomUUID } from 'node:crypto'
import type { AiComment, AiCommentResult, AskAiInput } from '@shared/ai-comments'
import type { Task } from '@shared/types'
import { ancestorsOf } from './ai-context'
import { finishAiFlight, isCurrentAiFlight, startAiFlight } from './ai-flight'
import { parseAnswerJson } from './ai-parse'
import { ANSWER_SCHEMA, buildAnswerMessages } from './ai-prompts'
import { readAiSettings } from './ai-settings-store'
import { insertComment } from './ai-store'
import { getTask, listTasksByDate } from './database'
import { requestChat } from './lm-studio'

function eligible(task: Task | undefined): task is Task {
  return Boolean(task && task.side === 'right' && !task.done && task.droppedAt === null)
}

export async function askAi(input: AskAiInput): Promise<AiCommentResult> {
  const flight = startAiFlight('user', input.requestId)
  try {
    const settings = readAiSettings()
    if (!settings.enabled || input.text.trim() === '') return { kind: 'none' }
    const task = getTask(input.taskId)
    if (!eligible(task) || task.text !== input.text) return { kind: 'none' }
    const reply = await requestChat({
      baseUrl: settings.baseUrl,
      model: settings.model,
      messages: buildAnswerMessages(task, ancestorsOf(task), listTasksByDate(task.dateCreated)),
      schema: ANSWER_SCHEMA,
      signal: flight.controller.signal,
    })
    if (!isCurrentAiFlight(flight)) return { kind: 'none' }
    if (!reply.ok) return reply.badAnswer ? { kind: 'none' } : { kind: 'offline' }
    if (!('json' in reply)) return { kind: 'none' }
    const text = parseAnswerJson(reply.json)
    if (text === null) return { kind: 'none' }
    // This answer belongs to the submitted snapshot, even if the person has since edited it.
    if (!readAiSettings().enabled || !eligible(getTask(input.taskId))) return { kind: 'none' }
    const comment: AiComment = {
      id: randomUUID(),
      taskId: task.id,
      side: 'right',
      type: 'remark',
      text,
      status: 'open',
      keptRanges: '[]',
      x: 0,
      y: 0,
      createdAt: new Date().toISOString(),
      replies: [],
    }
    insertComment(comment)
    return { kind: 'comment', comment }
  } finally {
    finishAiFlight(flight)
  }
}
