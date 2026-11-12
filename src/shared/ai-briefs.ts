export interface Brief {
  id: string
  name: string
  filePath: string
  summary: string
  contentHash: string
  mtimeMs: number
  enabled: boolean
  alwaysInclude: boolean
  createdAt: string
  updatedAt: string
}

// A row plus what the file said the last time main looked at it.
export interface BriefView extends Brief {
  stale: boolean
  truncated: boolean
  unreadable: string | null
}

export interface BriefResult {
  ok: boolean
  brief?: Brief
  briefs?: Brief[]
  message?: string
}

export const BRIEF_EXTENSIONS = ['.md', '.markdown'] as const
export const BRIEF_SUMMARY_MAX_CHARS = 200
export const BRIEF_MAX_CHARS = 8_000
export const BRIEF_NAME_MAX_CHARS = 80
export const DEFAULT_BRIEFS_MAX_CHARS = 6_000
export const BRIEFS_MAX_CHARS_RANGE = { min: 500, max: 60_000 }

// '@r' routes a row to the model as a request, so no brief may answer to that name.
export const RESERVED_BRIEF_NAME = 'r'

export function normalizeBriefName(name: string): string {
  return name.trim().toLowerCase()
}

export function briefNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'A brief needs a name.'
  if (trimmed.length > BRIEF_NAME_MAX_CHARS) return `A brief name is at most ${BRIEF_NAME_MAX_CHARS} characters.`
  if (/[\\/:*?"<>|]/.test(trimmed)) return 'A brief name cannot contain those characters.'
  if (normalizeBriefName(trimmed) === RESERVED_BRIEF_NAME) {
    return 'That name is reserved for a request row.'
  }
  return null
}

export function briefNameTaken(name: string, taken: Iterable<string>): boolean {
  const key = normalizeBriefName(name)
  for (const other of taken) {
    if (normalizeBriefName(other) === key) return true
  }
  return false
}

export function isBriefView(value: unknown): value is BriefView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.id === 'string' &&
    typeof input.name === 'string' &&
    typeof input.filePath === 'string' &&
    typeof input.summary === 'string' &&
    typeof input.contentHash === 'string' &&
    typeof input.mtimeMs === 'number' &&
    typeof input.enabled === 'boolean' &&
    typeof input.alwaysInclude === 'boolean' &&
    typeof input.createdAt === 'string' &&
    typeof input.updatedAt === 'string' &&
    typeof input.stale === 'boolean' &&
    typeof input.truncated === 'boolean' &&
    (input.unreadable === null || typeof input.unreadable === 'string')
  )
}

export function isBriefViewList(value: unknown): value is BriefView[] {
  return Array.isArray(value) && value.every(isBriefView)
}

export function isBriefResult(value: unknown): value is BriefResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (typeof input.ok !== 'boolean') return false
  if (input.message !== undefined && typeof input.message !== 'string') return false
  if (input.brief !== undefined && !isBriefShape(input.brief)) return false
  return input.briefs === undefined || (Array.isArray(input.briefs) && input.briefs.every(isBriefShape))
}

function isBriefShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return (
    typeof input.id === 'string' &&
    typeof input.name === 'string' &&
    typeof input.filePath === 'string' &&
    typeof input.summary === 'string' &&
    typeof input.contentHash === 'string' &&
    typeof input.mtimeMs === 'number' &&
    typeof input.enabled === 'boolean' &&
    typeof input.alwaysInclude === 'boolean' &&
    typeof input.createdAt === 'string' &&
    typeof input.updatedAt === 'string'
  )
}
