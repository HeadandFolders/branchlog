import { expect, test } from '@playwright/test'
import { listModels, parseJsonReply, requestChat, type ChatOptions, type ChatReply } from '../src/main/lm-studio'
import { startMockLmStudio, type MockLmStudio } from './mock-lm-studio'

let mock: MockLmStudio

test.beforeEach(async () => {
  mock = await startMockLmStudio()
})

test.afterEach(async () => {
  await mock.close()
})

function chat(overrides: Partial<ChatOptions> = {}): Promise<ChatReply> {
  return requestChat({
    baseUrl: mock.url,
    messages: [{ role: 'user', content: 'plan the garden' }],
    schema: {
      name: 'margin_comment',
      schema: {
        type: 'object',
        properties: { comment: { type: ['string', 'null'] }, type: { type: 'string' } },
        required: ['comment', 'type'],
      },
    },
    ...overrides,
  })
}

const SCHEMA_SHAPE = { name: 'margin_comment', schema: { type: 'object' } }

test('a JSON answer comes back parsed, with stream false and the first loaded model', async () => {
  const reply = await chat({ schema: SCHEMA_SHAPE })
  expect(reply).toEqual({ ok: true, json: { comment: 'What does done look like for this?', type: 'question' } })
  const post = mock.requests.find((request) => request.method === 'POST')
  expect(post?.body?.stream).toBe(false)
  expect(post?.body?.model).toBe('mock-model')
  expect(post?.body?.response_format).toBeTruthy()
  expect(mock.requests.some((request) => request.url === '/v1/models')).toBe(true)
})

test('a configured model skips the model list', async () => {
  const reply = await chat({ model: 'my-model', schema: SCHEMA_SHAPE })
  expect(reply.ok).toBe(true)
  expect(mock.requests.some((request) => request.url === '/v1/models')).toBe(false)
  expect(mock.requests[0].body?.model).toBe('my-model')
})

test('a null comment is a valid answer', async () => {
  mock.setChatMode('null')
  const reply = await chat({ schema: SCHEMA_SHAPE })
  expect(reply).toEqual({ ok: true, json: { comment: null } })
})

test('JSON wrapped in code fences is unwrapped', async () => {
  mock.setChatMode('fenced')
  const reply = await chat({ schema: SCHEMA_SHAPE })
  expect(reply).toEqual({ ok: true, json: { comment: 'What does done look like for this?', type: 'question' } })
})

test('malformed JSON is an error, not a crash', async () => {
  mock.setChatMode('malformed')
  const reply = await chat({ schema: SCHEMA_SHAPE })
  expect(reply.ok).toBe(false)
  if (!reply.ok) {
    expect(reply.message).toContain('JSON')
    expect(reply.badAnswer).toBe(true)
  }
})

test('a slow answer times out with a clear message', async () => {
  mock.setChatMode('delayed')
  const reply = await chat({ schema: SCHEMA_SHAPE, timeoutMs: 200 })
  expect(reply.ok).toBe(false)
  if (!reply.ok) expect(reply.message).toContain('Timed out')
})

test('an aborted request stops with Aborted', async () => {
  mock.setChatMode('delayed')
  const controller = new AbortController()
  const pending = chat({ schema: SCHEMA_SHAPE, signal: controller.signal })
  controller.abort()
  const reply = await pending
  expect(reply.ok).toBe(false)
  if (!reply.ok) expect(reply.message).toBe('Aborted')
})

test('an HTTP 500 surfaces the status and the server message', async () => {
  mock.setChatMode('error500')
  const reply = await chat({ schema: SCHEMA_SHAPE })
  expect(reply.ok).toBe(false)
  if (!reply.ok) {
    expect(reply.message).toContain('500')
    expect(reply.message).toContain('mock model crashed')
  }
})

test('an offline server is reported with the address, never thrown', async () => {
  const dead = await startMockLmStudio()
  const url = dead.url
  await dead.close()
  const reply = await requestChat({ baseUrl: url, messages: [{ role: 'user', content: 'x' }] })
  expect(reply.ok).toBe(false)
  if (!reply.ok) {
    expect(reply.message).toContain(url)
    expect(reply.badAnswer).toBeUndefined()
  }
  const listed = await listModels(url)
  expect(listed.ok).toBe(false)
})

test('a server without structured output falls back to asking for JSON', async () => {
  await mock.close()
  mock = await startMockLmStudio({ rejectResponseFormat: true })
  const reply = await chat({ schema: SCHEMA_SHAPE })
  expect(reply).toEqual({ ok: true, json: { comment: 'What does done look like for this?', type: 'question' } })
  const posts = mock.requests.filter((request) => request.method === 'POST')
  expect(posts).toHaveLength(2)
  expect(posts[0].body?.response_format).toBeTruthy()
  expect(posts[1].body?.response_format).toBeUndefined()
  const messages = posts[1].body?.messages as { role: string; content: string }[]
  expect(messages.at(-1)?.content).toContain('JSON')
})

test('without a schema the answer stays plain text', async () => {
  mock.setChatMode('plain')
  const reply = await chat({ schema: undefined })
  expect(reply).toEqual({ ok: true, content: 'Try a smaller first step.' })
  expect(mock.requests[0].body?.response_format).toBeUndefined()
})

test('the model list reports success, no model loaded, and offline distinctly', async () => {
  const listed = await listModels(mock.url)
  expect(listed).toEqual({ ok: true, models: ['mock-model'] })
  mock.setModels([])
  const empty = await listModels(mock.url)
  expect(empty.ok).toBe(false)
  if (!empty.ok) expect(empty.message).toContain('no model is loaded')
})

test('parseJsonReply tolerates surrounding text and rejects non-objects', () => {
  expect(parseJsonReply('Sure! Here it is: {"comment": null} hope that helps')).toEqual({ comment: null })
  expect(parseJsonReply('```\n{"a": 1}\n```')).toEqual({ a: 1 })
  expect(parseJsonReply('no json here')).toBeNull()
  expect(parseJsonReply('[1, 2]')).toBeNull()
  expect(parseJsonReply('{"broken": ')).toBeNull()
})