import type { AiConnectionResult } from '@shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  baseUrl: string
  model?: string
  messages: ChatMessage[]
  schema?: { name: string; schema: Record<string, unknown> }
  timeoutMs?: number
  signal?: AbortSignal
}

export type ChatReply =
  | { ok: true; content: string }
  | { ok: true; json: unknown }
  | { ok: false; message: string; badAnswer?: boolean }

const CHAT_TIMEOUT_MS = 60_000
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

export async function requestChat(options: ChatOptions): Promise<ChatReply> {
  const resolved = await resolveModel(options.baseUrl, options.model, options.signal)
  if (!resolved.ok) return resolved
  const model = resolved.model
  const url = `${options.baseUrl}/chat/completions`
  const body = {
    model,
    messages: options.messages,
    stream: false,
    ...(options.schema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: options.schema.name, strict: true, schema: options.schema.schema },
          },
        }
      : {}),
  }
  const timeoutMs = options.timeoutMs ?? CHAT_TIMEOUT_MS
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
  let fetched = await fetchChecked(url, init, timeoutMs, options.signal)
  if (!fetched.ok && options.schema && /response_format|json_schema/i.test(fetched.message)) {
    const { response_format: _rejected, ...plain } = body
    const fallback = {
      ...plain,
      messages: [
        ...options.messages,
        { role: 'system' as const, content: 'Respond with only a single valid JSON object and no other text.' },
      ],
    }
    fetched = await fetchChecked(
      url,
      { ...init, body: JSON.stringify(fallback) },
      timeoutMs,
      options.signal,
    )
  }
  if (!fetched.ok) return fetched
  let content: unknown
  try {
    const payload = (await fetched.response.json()) as { choices?: { message?: { content?: unknown } }[] }
    content = payload.choices?.[0]?.message?.content
  } catch (error) {
    return { ok: false, message: `The server returned an unreadable answer (${errorMessage(error)})`, badAnswer: true }
  }
  if (typeof content !== 'string') return { ok: false, message: 'The model returned no text', badAnswer: true }
  if (!options.schema) return { ok: true, content }
  const json = parseJsonReply(content)
  if (json === null) return { ok: false, message: 'The model did not return valid JSON', badAnswer: true }
  return { ok: true, json }
}