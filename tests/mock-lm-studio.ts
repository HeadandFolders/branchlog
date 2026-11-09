import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type MockChatMode = 'json' | 'null' | 'fenced' | 'malformed' | 'delayed' | 'error500' | 'plain' | 'reply'

export interface MockRequest {
  method: string
  url: string
  body: Record<string, unknown> | null
}

export interface MockLmStudio {
  url: string
  requests: MockRequest[]
  setChatMode: (mode: MockChatMode) => void
  setModels: (ids: string[]) => void
  close: () => Promise<void>
}

const COMMENT = { comment: 'What does done look like for this?', type: 'question' }

function chatBody(mode: MockChatMode): { status: number; payload: unknown } {
  if (mode === 'error500') return { status: 500, payload: { error: 'mock model crashed' } }
  if (mode === 'malformed') return { status: 200, payload: completion('{"comment": "unterminated') }
  if (mode === 'fenced') return { status: 200, payload: completion('```json\n' + JSON.stringify(COMMENT) + '\n```') }
  if (mode === 'null') return { status: 200, payload: completion(JSON.stringify({ comment: null })) }
  if (mode === 'plain') return { status: 200, payload: completion('Try a smaller first step.') }
  if (mode === 'reply') return { status: 200, payload: completion(JSON.stringify({ reply: 'A smaller first step still counts.' })) }
  return { status: 200, payload: completion(JSON.stringify(COMMENT)) }
}

function completion(content: string): unknown {
  return { choices: [{ message: { role: 'assistant', content } }] }
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  if (response.writableEnded || response.destroyed) return
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

export async function startMockLmStudio(
  options: { chatMode?: MockChatMode; delayMs?: number; rejectResponseFormat?: boolean; models?: string[] } = {},
): Promise<MockLmStudio> {
  let chatMode = options.chatMode ?? 'json'
  let models = options.models ?? ['mock-model']
  const delayMs = options.delayMs ?? 1500
  const requests: MockRequest[] = []
  const timers = new Set<NodeJS.Timeout>()

  const server: Server = createServer((request, response) => {
    const url = request.url ?? ''
    if (request.method === 'GET' && url === '/v1/models') {
      requests.push({ method: 'GET', url, body: null })
      send(response, 200, { data: models.map((id) => ({ id, object: 'model' })) })
      return
    }
    if (request.method === 'POST' && url === '/v1/chat/completions') {
      let raw = ''
      request.on('data', (chunk: Buffer) => {
        raw += chunk.toString()
      })
      request.on('end', () => {
        let body: Record<string, unknown> | null = null
        try {
          body = JSON.parse(raw) as Record<string, unknown>
        } catch {
          body = null
        }
        requests.push({ method: 'POST', url, body })
        if (options.rejectResponseFormat && body && 'response_format' in body) {
          send(response, 400, { error: "response_format is not supported by this engine" })
          return
        }
        const answer = chatBody(chatMode)
        const finish = (): void => send(response, answer.status, answer.payload)
        if (chatMode === 'delayed') {
          const timer = setTimeout(() => {
            timers.delete(timer)
            finish()
          }, delayMs)
          timers.add(timer)
          return
        }
        finish()
      })
      return
    }
    requests.push({ method: request.method ?? '', url, body: null })
    send(response, 404, { error: `no route for ${url}` })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    setChatMode: (mode) => {
      chatMode = mode
    },
    setModels: (ids) => {
      models = ids
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of timers) clearTimeout(timer)
        timers.clear()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}