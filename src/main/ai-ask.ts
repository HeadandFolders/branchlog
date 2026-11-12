import { randomUUID } from 'node:crypto'
import type {
  AiComment,
  AiCommentResult,
  AiCommentType,
  AskAiInput,
  PendingSave,
} from '@shared/ai-comments'
import { SAVE_FILE_NAME, SAVE_FILE_TOOL } from '@shared/ai-tools'
import type { Task } from '@shared/types'
import { refsForTask, withBriefContext } from './ai-brief-context'
import { ancestorsOf } from './ai-context'
import { finishAiFlight, isCurrentAiFlight, startAiFlight } from './ai-flight'
import { classifyProse, parseAnswerJson, truncateToCharBudget } from './ai-parse'
import { ANSWER_SCHEMA, buildAnswerMessages, buildRequestAnswerMessages } from './ai-prompts'
import { briefIdsForProject, projectForComment } from './ai-project'
import { readAiSettings } from './ai-settings-store'
import { insertComment } from './ai-store'
import { getTask, listTasksByDate } from './database'
import { requestChat, type ChatReply, type ToolCall } from './lm-studio'

interface OutgoingAnswer {
  text: string
  type: AiCommentType
  pendingSave?: PendingSave
}

function eligible(task: Task | undefined): task is Task {
  return Boolean(task && task.side === 'right' && !task.done && task.droppedAt === null)
}

// The name is only a suggestion for a save dialog the person has to confirm, so it can never carry
// a path or outlive one screen.
function suggestedName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.replace(/[\\/]/g, ' ').trim().slice(0, 80)
  return name === '' ? undefined : name
}

function saveFileArguments(toolCalls: ToolCall[]): Record<string, unknown> | null {
  for (const call of toolCalls) {
    if (call.name === SAVE_FILE_NAME && call.arguments !== null) return call.arguments
  }
  return null
}

// A save_file call is the document itself, so it wins over prose. Prose starting with QUESTION: is
// the one question the prompt allows; any other prose is the deliverable.
function readToolReply(reply: ChatReply, maxChars: number): OutgoingAnswer | null {
  if (!('text' in reply)) return null
  const args = 'toolCalls' in reply ? saveFileArguments(reply.toolCalls) : null
  if (args) {
    const content = typeof args.content === 'string' ? args.content.trim() : ''
    if (content === '') return null
    // One text for both the bubble and the file, so a cut answer never saves more than it shows.
    const body = truncateToCharBudget(content, maxChars)
    const name = suggestedName(args.suggestedName)
    return {
      text: body,
      type: 'remark',
      pendingSave: name === undefined ? { content: body } : { content: body, suggestedName: name },
    }
  }
  if (reply.text === '') return null
  const prose = classifyProse(reply.text)
  return {
    text: truncateToCharBudget(prose.text, maxChars),
    type: prose.kind === 'question' ? 'question' : 'remark',
  }
}

function readSchemaReply(reply: ChatReply, maxChars: number): OutgoingAnswer | null {
  if (!('json' in reply)) return null
  const text = parseAnswerJson(reply.json, maxChars)
  return text === null ? null : { text, type: 'remark' }
}

export async function askAi(input: AskAiInput): Promise<AiCommentResult> {
  const flight = startAiFlight('user', input.requestId)
  try {
    const settings = readAiSettings()
    if (!settings.enabled || input.text.trim() === '') return { kind: 'none' }
    const task = getTask(input.taskId)
    if (!eligible(task) || task.text !== input.text) return { kind: 'none' }
    const ancestors = ancestorsOf(task)
    const dayTasks = listTasksByDate(task.dateCreated)
    const refs = refsForTask(task)
    const project = projectForComment(task)
    const messages = withBriefContext({
      messages: input.request
        ? buildRequestAnswerMessages(task, ancestors, dayTasks, settings.requestClarify)
        : buildAnswerMessages(task, ancestors, dayTasks, settings.requestClarify),
      briefIds: briefIdsForProject(refs.briefIds, project.projectId),
      dayNote: refs.dayNote,
      modelContextTokens: settings.modelContextTokens,
      answerMaxChars: settings.answerMaxChars,
    })
    const reply = await requestChat(
      input.request
        ? {
            baseUrl: settings.baseUrl,
            model: settings.model,
            messages,
            tools: [SAVE_FILE_TOOL],
            answerMaxChars: settings.answerMaxChars,
            modelContextTokens: settings.modelContextTokens,
            thinkingMode: settings.thinkingMode,
            timeoutMs: settings.chatTimeoutMs,
            signal: flight.controller.signal,
          }
        : {
            baseUrl: settings.baseUrl,
            model: settings.model,
            messages,
            schema: ANSWER_SCHEMA,
            timeoutMs: settings.chatTimeoutMs,
            signal: flight.controller.signal,
          },
    )
    if (!isCurrentAiFlight(flight)) return { kind: 'none' }
    if (!reply.ok) return reply.badAnswer ? { kind: 'none' } : { kind: 'offline' }
    const answer = input.request
      ? readToolReply(reply, settings.answerMaxChars)
      : readSchemaReply(reply, settings.answerMaxChars)
    if (answer === null) return { kind: 'none' }
    // This answer belongs to the submitted snapshot, even if the person has since edited it.
    if (!readAiSettings().enabled || !eligible(getTask(input.taskId))) return { kind: 'none' }
    const comment: AiComment = {
      id: randomUUID(),
      taskId: task.id,
      side: 'right',
      type: answer.type,
      text: answer.text,
      status: 'open',
      keptRanges: '[]',
      x: 0,
      y: 0,
      createdAt: new Date().toISOString(),
      projectId: project.projectId,
      projectPinned: project.projectPinned,
      replies: [],
    }
    insertComment(comment)
    if (!answer.pendingSave) return { kind: 'comment', comment }
    return { kind: 'comment', comment, pendingSave: answer.pendingSave }
  } finally {
    finishAiFlight(flight)
  }
}
