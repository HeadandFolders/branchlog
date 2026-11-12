import { expect, test } from '@playwright/test'
import { requestChat, type ChatReply, type ToolChatOptions } from '../src/main/lm-studio'
import { SAVE_FILE_TOOL } from '../src/shared/ai-tools'

interface Recorded {
  url: string
  body: Record<string, unknown>
}

let originalFetch: typeof globalThis.fetch

function completion(content: unknown, finishReason: string | null, toolCalls?: unknown): unknown {
  const message: Record<string, unknown> = { role: 'assistant', content }
  if (toolCalls !== undefined) message.tool_calls = toolCalls
  return { choices: [{ message, finish_reason: finishReason }] }
}

// One stub for the whole file: every queued payload answers the next POST, and the last one repeats
// so a test can count the requests a retry path made.
function stubFetch(payloads: unknown[]): Recorded[] {
  const recorded: Recorded[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    recorded.push({ url: String(input), body })
    const payload = payloads[Math.min(recorded.length - 1, payloads.length - 1)]
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof globalThis.fetch
  return recorded
}

function toolCallList(id: string, args: string): unknown {
  return [{ id, type: 'function', function: { name: SAVE_FILE_TOOL.function.name, arguments: args } }]
}

function toolRequest(overrides: Partial<ToolChatOptions> = {}): ToolChatOptions {
  return {
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'test-model',
    messages: [
      { role: 'system', content: 'You write files.' },
      { role: 'user', content: 'Draft the plan.' },
    ],
    timeoutMs: 10_000,
    tools: [SAVE_FILE_TOOL],
    answerMaxChars: 8_000,
    modelContextTokens: 8_192,
    ...overrides,
  }
}

function textOf(reply: ChatReply): string {
  if (!('text' in reply)) throw new Error(`expected text, got ${JSON.stringify(reply)}`)
  return reply.text
}

const SCHEMA = { name: 'branch_answer', schema: { type: 'object' } }
const PROSE = 'A shorter first step still counts.'

test.beforeEach(() => {
  originalFetch = globalThis.fetch
})

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('a tool request carries tools, tool_choice and max_tokens, and never a response_format', async () => {
  const recorded = stubFetch([completion(PROSE, 'stop')])
  const reply = await requestChat(toolRequest())
  expect(recorded).toHaveLength(1)
  expect(recorded[0].url).toBe('http://127.0.0.1:1/v1/chat/completions')
  expect(recorded[0].body.response_format).toBeUndefined()
  expect(recorded[0].body.tools).toEqual([SAVE_FILE_TOOL])
  expect(recorded[0].body.tool_choice).toBe('auto')
  expect(recorded[0].body.thinking).toEqual({ type: 'enabled' })
  expect(textOf(reply)).toBe(PROSE)
})

test('a schema request carries a response_format and never tools or max_tokens', async () => {
  const recorded = stubFetch([completion('{"answer":"useful"}', 'stop')])
  const reply = await requestChat({
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'test-model',
    messages: [{ role: 'user', content: 'ask' }],
    schema: SCHEMA,
    timeoutMs: 10_000,
  })
  expect(recorded[0].body.response_format).toBeTruthy()
  expect(recorded[0].body.tools).toBeUndefined()
  expect(recorded[0].body.max_tokens).toBeUndefined()
  expect(reply).toEqual({ ok: true, json: { answer: 'useful' } })
})

test('max_tokens is three times the body budget and never fills past the context', async () => {
  const promptTokens = Math.ceil('You write files.'.length / 4) + Math.ceil('Draft the plan.'.length / 4)
  const near = stubFetch([completion(PROSE, 'stop')])
  await requestChat(toolRequest({ answerMaxChars: 8_000 }))
  expect(near[0].body.max_tokens).toBe(6_000)

  const wide = stubFetch([completion(PROSE, 'stop')])
  await requestChat(toolRequest({ answerMaxChars: 40_000 }))
  expect(wide[0].body.max_tokens).toBe(8_192 - promptTokens)
})

test('thinkingMode off sends thinking disabled', async () => {
  const recorded = stubFetch([completion(PROSE, 'stop')])
  await requestChat(toolRequest({ thinkingMode: 'off' }))
  expect(recorded[0].body.thinking).toEqual({ type: 'disabled' })
})

test('a 9000-character answer comes back as text, cut at its last full sentence', async () => {
  const long = 'Word. '.repeat(1_500)
  expect(long).toHaveLength(9_000)
  const recorded = stubFetch([completion(long, 'stop')])
  const reply = await requestChat(toolRequest({ answerMaxChars: 8_000 }))
  expect(recorded).toHaveLength(1)
  const text = textOf(reply)
  expect(text.length).toBeLessThanOrEqual(8_000)
  expect(text.endsWith('Word. [truncated]')).toBe(true)
  expect(text.startsWith('Word. Word.')).toBe(true)
})

test('a length stop with partial content still returns that content', async () => {
  const partial = `${'Word. '.repeat(300)}half a w`
  stubFetch([completion(partial, 'length')])
  const reply = await requestChat(toolRequest({ answerMaxChars: 8_000 }))
  expect(textOf(reply)).toBe(partial)
  if (!('finishReason' in reply)) throw new Error('expected a finish reason')
  expect(reply.finishReason).toBe('length')
})

test('a length stop with no content retries once with thinking off and the same max_tokens', async () => {
  const recorded = stubFetch([completion('', 'length'), completion('Here is the plan.', 'stop')])
  const reply = await requestChat(toolRequest())
  expect(recorded).toHaveLength(2)
  expect(recorded[0].body.thinking).toEqual({ type: 'enabled' })
  expect(recorded[1].body.thinking).toEqual({ type: 'disabled' })
  expect(recorded[1].body.max_tokens).toBe(recorded[0].body.max_tokens)
  expect(recorded[1].body.tools).toEqual([SAVE_FILE_TOOL])
  expect(textOf(reply)).toBe('Here is the plan.')
})

test('still no output after the one retry is a typed result, never a throw', async () => {
  const recorded = stubFetch([completion('', 'length'), completion(null, 'length')])
  const reply = await requestChat(toolRequest())
  expect(reply).toEqual({ ok: true, kind: 'no-output' })
  expect(recorded).toHaveLength(2)
})

test('thinking was already off, so an empty answer is no-output with no retry', async () => {
  const recorded = stubFetch([completion('', 'length')])
  const reply = await requestChat(toolRequest({ thinkingMode: 'off' }))
  expect(reply).toEqual({ ok: true, kind: 'no-output' })
  expect(recorded).toHaveLength(1)
})

test('tool_calls come back parsed, with the arguments read from the json string', async () => {
  const args = JSON.stringify({ content: 'the whole file body', suggestedName: 'plan.md' })
  stubFetch([completion(null, 'tool_calls', toolCallList('call-1', args))])
  const reply = await requestChat(toolRequest())
  if (!('toolCalls' in reply)) throw new Error(`expected tool calls, got ${JSON.stringify(reply)}`)
  expect(reply.finishReason).toBe('tool_calls')
  expect(reply.text).toBe('')
  expect(reply.toolCalls).toEqual([
    { id: 'call-1', name: 'save_file', arguments: { content: 'the whole file body', suggestedName: 'plan.md' } },
  ])
})

test('a tool call whose arguments will not parse keeps the name and reports null arguments', async () => {
  stubFetch([completion(null, 'tool_calls', toolCallList('call-1', '{"content": '))])
  const reply = await requestChat(toolRequest())
  if (!('toolCalls' in reply)) throw new Error(`expected tool calls, got ${JSON.stringify(reply)}`)
  expect(reply.toolCalls[0]?.arguments).toBeNull()
})

test('a tool-mode call that answers in prose returns the prose, not an error', async () => {
  const recorded = stubFetch([completion('Which project should this land in?', 'stop')])
  const reply = await requestChat(toolRequest())
  expect(recorded).toHaveLength(1)
  expect(textOf(reply)).toBe('Which project should this land in?')
  if (!('toolCalls' in reply)) throw new Error('expected tool calls')
  expect(reply.toolCalls).toEqual([])
})
