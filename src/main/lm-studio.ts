import { estimatePromptTokens, toolModeMaxTokens } from '@shared/ai-budget'
import { DEFAULT_CHAT_TIMEOUT_MS, DEFAULT_THINKING_MODE, type AiThinkingMode } from '@shared/ai-settings'
import type { ToolDefinition } from '@shared/ai-tools'
import type { AiConnectionResult } from '@shared/types'
import { truncateToCharBudget } from './ai-parse'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown> | null
}

export type ChatFinishReason = 'stop' | 'length' | 'tool_calls' | 'other' | null

export interface SchemaSpec {
  name: string
  schema: Record<string, unknown>
}

interface ChatCommon {
  baseUrl: string
  model?: string
  messages: ChatMessage[]
  timeoutMs?: number
  signal?: AbortSignal
}

interface SchemaModeRequest {
  schema: SchemaSpec
  tools?: undefined
  thinkingMode?: AiThinkingMode
  answerMaxChars?: undefined
  modelContextTokens?: undefined
}

// LM Studio rejects schema and tools in one request, so the two modes are separate option shapes
// and asking for both is not a type that exists.
interface ToolModeRequest {
  tools: ToolDefinition[]
  schema?: undefined
  thinkingMode?: AiThinkingMode
  answerMaxChars: number
  modelContextTokens: number
}

interface PlainModeRequest {
  schema?: undefined
  tools?: undefined
  thinkingMode?: AiThinkingMode
  answerMaxChars?: number
  modelContextTokens?: undefined
}

export type SchemaChatOptions = ChatCommon & SchemaModeRequest
export type ToolChatOptions = ChatCommon & ToolModeRequest
export type PlainChatOptions = ChatCommon & PlainModeRequest
export type ChatOptions = SchemaChatOptions | ToolChatOptions | PlainChatOptions

export type ChatReply =
  | { ok: true; text: string; toolCalls: ToolCall[]; finishReason: ChatFinishReason }
  | { ok: true; json: unknown }
  | { ok: true; kind: 'no-output' }
  | { ok: false; message: string; badAnswer?: boolean }

const MODELS_TIMEOUT_MS = 10_000

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    if (cause instanceof Error && cause.message) return cause.message
    return error.message
  }
  return String(error)
}

async function fetchChecked(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: true; response: Response } | { ok: false; message: string }> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const response = await fetch(url, { ...init, signal: combined })
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300).trim()
      return { ok: false, message: `HTTP ${response.status}${body ? `: ${body}` : ''}` }
    }
    return { ok: true, response }
  } catch (error) {
    if (signal?.aborted) return { ok: false, message: 'Aborted' }
    if (timeout.aborted) return { ok: false, message: `Timed out after ${timeoutMs} ms` }
    return { ok: false, message: `Cannot reach ${url} (${errorMessage(error)})` }
  }
}

export async function listModels(baseUrl: string, signal?: AbortSignal): Promise<AiConnectionResult> {
  const url = `${baseUrl}/models`
  const fetched = await fetchChecked(url, { method: 'GET' }, MODELS_TIMEOUT_MS, signal)
  if (!fetched.ok) return fetched
  let payload: unknown
  try {
    payload = await fetched.response.json()
  } catch (error) {
    return { ok: false, message: `The server did not return a model list (${errorMessage(error)})` }
  }
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return { ok: false, message: 'The server did not return a model list' }
  const models = data
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string')
  if (models.length === 0) return { ok: false, message: 'The server is running but no model is loaded' }
  return { ok: true, models }
}

export function parseJsonReply(content: string): unknown | null {
  let text = content.trim()
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(text)
  if (fenced) text = fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

async function resolveModel(
  baseUrl: string,
  model: string | undefined,
  signal?: AbortSignal,
): Promise<{ ok: true; model: string } | { ok: false; message: string }> {
  if (model && model.trim() !== '') return { ok: true, model: model.trim() }
  const listed = await listModels(baseUrl, signal)
  if (!listed.ok) return listed
  return { ok: true, model: listed.models[0] }
}

interface CompletionFields {
  content: unknown
  toolCalls: ToolCall[]
  finishReason: ChatFinishReason
}

function normalizeFinishReason(value: unknown): ChatFinishReason {
  if (value === 'stop' || value === 'length' || value === 'tool_calls') return value
  if (value === undefined || value === null) return null
  return 'other'
}

function parseToolArguments(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parseToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return []
  const calls: ToolCall[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const call = entry as { id?: unknown; function?: unknown }
    if (typeof call.function !== 'object' || call.function === null) continue
    const target = call.function as { name?: unknown; arguments?: unknown }
    if (typeof target.name !== 'string' || target.name === '') continue
    calls.push({
      id: typeof call.id === 'string' ? call.id : '',
      name: target.name,
      arguments: parseToolArguments(target.arguments),
    })
  }
  return calls
}

function readCompletion(payload: unknown): CompletionFields {
  const choices = (payload as { choices?: unknown }).choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  const choice = first as { message?: unknown; finish_reason?: unknown } | undefined
  const message = (choice?.message ?? {}) as { content?: unknown; tool_calls?: unknown }
  return {
    content: message.content,
    toolCalls: parseToolCalls(message.tool_calls),
    finishReason: normalizeFinishReason(choice?.finish_reason),
  }
}

function contentText(content: unknown): string {
  return typeof content === 'string' ? content.trim() : ''
}

function thinkingField(mode: AiThinkingMode | undefined): Record<string, unknown> {
  if (mode === undefined) return {}
  return { thinking: { type: mode === 'on' ? 'enabled' : 'disabled' } }
}

function jsonInit(body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function completeText(
  url: string,
  options: ChatOptions,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: true; completion: CompletionFields } | { ok: false; message: string; badAnswer?: boolean }> {
  const fetched = await fetchChecked(url, jsonInit(body), timeoutMs, options.signal)
  if (!fetched.ok) return fetched
  try {
    return { ok: true, completion: readCompletion(await fetched.response.json()) }
  } catch (error) {
    return { ok: false, message: `The server returned an unreadable answer (${errorMessage(error)})`, badAnswer: true }
  }
}

function textReply(completion: CompletionFields, answerMaxChars: number | undefined): ChatReply {
  const text = contentText(completion.content)
  return {
    ok: true,
    text: answerMaxChars === undefined ? text : truncateToCharBudget(text, answerMaxChars),
    toolCalls: completion.toolCalls,
    finishReason: completion.finishReason,
  }
}

// Thinking runs inside the same max_tokens as the body. On this hardware it can spend all of it and
// hand back nothing, so the one recovery is to take thinking away and ask again.
async function textRequest(
  options: ToolChatOptions | PlainChatOptions,
  url: string,
  model: string,
  timeoutMs: number,
): Promise<ChatReply> {
  const thinkingMode = options.thinkingMode ?? (options.tools ? DEFAULT_THINKING_MODE : undefined)
  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    stream: false,
    ...thinkingField(thinkingMode),
  }
  if (options.tools) {
    body.tools = options.tools
    body.tool_choice = 'auto'
    body.max_tokens = toolModeMaxTokens({
      answerMaxChars: options.answerMaxChars,
      promptTokens: estimatePromptTokens(options.messages),
      modelContextTokens: options.modelContextTokens,
    })
  }
  const first = await completeText(url, options, body, timeoutMs)
  if (!first.ok) return first
  if (contentText(first.completion.content) !== '' || first.completion.toolCalls.length > 0) {
    return textReply(first.completion, options.answerMaxChars)
  }
  if (thinkingMode !== 'on') return { ok: true, kind: 'no-output' }
  const retry = await completeText(url, options, { ...body, ...thinkingField('off') }, timeoutMs)
  if (!retry.ok) return retry
  if (contentText(retry.completion.content) !== '' || retry.completion.toolCalls.length > 0) {
    return textReply(retry.completion, options.answerMaxChars)
  }
  return { ok: true, kind: 'no-output' }
}

async function schemaRequest(options: SchemaChatOptions, url: string, model: string, timeoutMs: number): Promise<ChatReply> {
  const thinking = thinkingField(options.thinkingMode)
  const body = {
    model,
    messages: options.messages,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: options.schema.name, strict: true, schema: options.schema.schema },
    },
    ...thinking,
  }
  let fetched = await fetchChecked(url, jsonInit(body), timeoutMs, options.signal)
  if (!fetched.ok && /response_format|json_schema/i.test(fetched.message)) {
    fetched = await fetchChecked(
      url,
      jsonInit({
        ...body,
        messages: [
          ...options.messages,
          { role: 'system' as const, content: 'Respond with only a single valid JSON object and no other text.' },
        ],
        response_format: undefined,
      }),
      timeoutMs,
      options.signal,
    )
  }
  if (!fetched.ok) return fetched
  let completion: CompletionFields
  try {
    completion = readCompletion(await fetched.response.json())
  } catch (error) {
    return { ok: false, message: `The server returned an unreadable answer (${errorMessage(error)})`, badAnswer: true }
  }
  if (typeof completion.content !== 'string') {
    return { ok: false, message: 'The model returned no text', badAnswer: true }
  }
  const json = parseJsonReply(completion.content)
  if (json === null) return { ok: false, message: 'The model did not return valid JSON', badAnswer: true }
  return { ok: true, json }
}

export async function requestChat(options: ChatOptions): Promise<ChatReply> {
  const resolved = await resolveModel(options.baseUrl, options.model, options.signal)
  if (!resolved.ok) return resolved
  const model = resolved.model
  const url = `${options.baseUrl}/chat/completions`
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS
  if (options.tools) return textRequest(options, url, model, timeoutMs)
  if (options.schema) return schemaRequest(options, url, model, timeoutMs)
  return textRequest(options, url, model, timeoutMs)
}