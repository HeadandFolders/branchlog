export interface AiSettings {
  enabled: boolean
  baseUrl: string
  model: string
  maxCommentsPerDay: number
  pauseDelayMs: number
}

export const DEFAULT_AI_BASE_URL = 'http://localhost:1234/v1'
export const MAX_COMMENTS_RANGE = { min: 0, max: 500 }
export const PAUSE_DELAY_RANGE = { min: 500, max: 60_000 }
const MAX_MODEL_LENGTH = 200

export function defaultAiSettings(): AiSettings {
  return {
    enabled: false,
    baseUrl: DEFAULT_AI_BASE_URL,
    model: '',
    maxCommentsPerDay: 30,
    pauseDelayMs: 2500,
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

export function parseAiSettings(value: unknown): AiSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid AI settings')
  }
  const input = value as Record<string, unknown>
  if (typeof input.enabled !== 'boolean') throw new Error('Invalid AI settings')
  if (typeof input.model !== 'string' || input.model.length > MAX_MODEL_LENGTH || input.model.includes('\0')) {
    throw new Error('Invalid AI settings')
  }
  return {
    enabled: input.enabled,
    baseUrl: parseBaseUrl(input.baseUrl),
    model: input.model.trim(),
    maxCommentsPerDay: requireIntegerInRange(input.maxCommentsPerDay, MAX_COMMENTS_RANGE.min, MAX_COMMENTS_RANGE.max),
    pauseDelayMs: requireIntegerInRange(input.pauseDelayMs, PAUSE_DELAY_RANGE.min, PAUSE_DELAY_RANGE.max),
  }
}