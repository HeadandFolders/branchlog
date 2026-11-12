export type AiThinkingMode = 'on' | 'off'

export interface AiSettings {
  enabled: boolean
  baseUrl: string
  model: string
  maxCommentsPerDay: number
  pauseDelayMs: number
  answerMaxChars: number
  chatTimeoutMs: number
  thinkingMode: AiThinkingMode
  modelContextTokens: number
  requestClarify: boolean
  remarkOnRequests: boolean
}

export const DEFAULT_AI_BASE_URL = 'http://localhost:1234/v1'
export const MAX_COMMENTS_RANGE = { min: 0, max: 500 }
export const PAUSE_DELAY_RANGE = { min: 500, max: 60_000 }
export const ANSWER_MAX_CHARS_RANGE = { min: 500, max: 40_000 }
export const CHAT_TIMEOUT_MS_RANGE = { min: 10_000, max: 600_000 }
export const MODEL_CONTEXT_TOKENS_RANGE = { min: 2_048, max: 131_072 }
export const DEFAULT_ANSWER_MAX_CHARS = 8_000
export const DEFAULT_CHAT_TIMEOUT_MS = 300_000
export const DEFAULT_THINKING_MODE: AiThinkingMode = 'on'
export const DEFAULT_MODEL_CONTEXT_TOKENS = 8_192
export const DEFAULT_REQUEST_CLARIFY = true
export const DEFAULT_REMARK_ON_REQUESTS = false
const MAX_MODEL_LENGTH = 200

export function defaultAiSettings(): AiSettings {
  return {
    enabled: false,
    baseUrl: DEFAULT_AI_BASE_URL,
    model: '',
    maxCommentsPerDay: 30,
    pauseDelayMs: 2500,
    answerMaxChars: DEFAULT_ANSWER_MAX_CHARS,
    chatTimeoutMs: DEFAULT_CHAT_TIMEOUT_MS,
    thinkingMode: DEFAULT_THINKING_MODE,
    modelContextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
    requestClarify: DEFAULT_REQUEST_CLARIFY,
    remarkOnRequests: DEFAULT_REMARK_ON_REQUESTS,
  }
}

export function parseBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 2000) {
    throw new Error('Invalid AI address')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Invalid AI address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid AI address')
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('Invalid AI address')
  }
  return url.toString().replace(/\/+$/, '')
}

export function isPrivateAddress(baseUrl: string): boolean {
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host.endsWith('.local')) return true
  host = host.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true
  }
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) {
    return true
  }
  const match = /^172\.(\d+)\./.exec(host)
  if (match) {
    const second = Number(match[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

function requireIntegerInRange(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error('Invalid AI settings')
  }
  return value
}

// Rows written before a field existed stay readable: absent means the default, present means it
// still has to pass. A strict read here would reset the whole row, including the address.
function optionalIntegerInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback
  return requireIntegerInRange(value, min, max)
}

export function isThinkingMode(value: unknown): value is AiThinkingMode {
  return value === 'on' || value === 'off'
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error('Invalid AI settings')
  return value
}

export function parseAiSettings(value: unknown): AiSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid AI settings')
  }
  const input = value as Record<string, unknown>
  if (typeof input.enabled !== 'boolean') throw new Error('Invalid AI settings')
  if (typeof input.model !== 'string' || input.model.length > MAX_MODEL_LENGTH || input.model.includes('\0')) {
    throw new Error('Invalid AI settings')
  }
  if (input.thinkingMode !== undefined && !isThinkingMode(input.thinkingMode)) {
    throw new Error('Invalid AI settings')
  }
  return {
    enabled: input.enabled,
    baseUrl: parseBaseUrl(input.baseUrl),
    model: input.model.trim(),
    maxCommentsPerDay: requireIntegerInRange(input.maxCommentsPerDay, MAX_COMMENTS_RANGE.min, MAX_COMMENTS_RANGE.max),
    pauseDelayMs: requireIntegerInRange(input.pauseDelayMs, PAUSE_DELAY_RANGE.min, PAUSE_DELAY_RANGE.max),
    answerMaxChars: optionalIntegerInRange(
      input.answerMaxChars,
      ANSWER_MAX_CHARS_RANGE.min,
      ANSWER_MAX_CHARS_RANGE.max,
      DEFAULT_ANSWER_MAX_CHARS,
    ),
    chatTimeoutMs: optionalIntegerInRange(
      input.chatTimeoutMs,
      CHAT_TIMEOUT_MS_RANGE.min,
      CHAT_TIMEOUT_MS_RANGE.max,
      DEFAULT_CHAT_TIMEOUT_MS,
    ),
    thinkingMode: isThinkingMode(input.thinkingMode) ? input.thinkingMode : DEFAULT_THINKING_MODE,
    modelContextTokens: optionalIntegerInRange(
      input.modelContextTokens,
      MODEL_CONTEXT_TOKENS_RANGE.min,
      MODEL_CONTEXT_TOKENS_RANGE.max,
      DEFAULT_MODEL_CONTEXT_TOKENS,
    ),
    requestClarify: optionalBoolean(input.requestClarify, DEFAULT_REQUEST_CLARIFY),
    remarkOnRequests: optionalBoolean(input.remarkOnRequests, DEFAULT_REMARK_ON_REQUESTS),
  }
}