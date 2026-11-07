import type { CreateBranchInput, CreateTaskInput, Task, UpdateTaskInput } from '@shared/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_TEXT = 20_000

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid request')
  }
  return value as Record<string, unknown>
}

export function requireDateKey(value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new Error('Invalid date')
  }
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Invalid date')
  }
  return value
}

export function requireId(value: unknown): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new Error('Invalid task')
  }
  return value
}

export function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT || value.includes('\0')) {
    throw new Error('Invalid text')
  }
  return value
}

export function parseCreateTask(value: unknown): CreateTaskInput {
  const input = requireRecord(value)
  const id = requireId(input.id)
  const dateCreated = requireDateKey(input.dateCreated)
  const text = input.text === undefined ? '' : requireText(input.text)
  let afterId: string | null = null
  if (input.afterId !== undefined && input.afterId !== null) {
    afterId = requireId(input.afterId)
  }
  return { id, dateCreated, text, afterId }
}

function requireCoordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -100_000 || value > 100_000) {
    throw new Error('Invalid position')
  }
  return value
}

export function parseCreateBranch(value: unknown): CreateBranchInput {
  const input = requireRecord(value)
  return {
    id: requireId(input.id),
    parentId: requireId(input.parentId),
    text: input.text === undefined ? '' : requireText(input.text),
    x: requireCoordinate(input.x),
    y: requireCoordinate(input.y),
  }
}

export function parseUpdateTask(value: unknown): UpdateTaskInput {
  const input = requireRecord(value)
  const id = requireId(input.id)
  const result: UpdateTaskInput = { id }
  if ('text' in input && input.text !== undefined) {
    result.text = requireText(input.text)
  }
  if ('done' in input && input.done !== undefined) {
    if (typeof input.done !== 'boolean') throw new Error('Invalid request')
    result.done = input.done
  }
  if ('x' in input && input.x !== undefined) result.x = requireCoordinate(input.x)
  if ('y' in input && input.y !== undefined) result.y = requireCoordinate(input.y)
  if (result.text === undefined && result.done === undefined && result.x === undefined && result.y === undefined) {
    throw new Error('Invalid request')
  }
  return result
}

function requireInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -1_000_000 || value > 1_000_000) {
    throw new Error('Invalid task')
  }
  return value
}

function parseSnapshot(value: unknown, date: string): Task {
  const input = requireRecord(value)
  const id = requireId(input.id)
  const dateCreated = requireDateKey(input.dateCreated)
  if (dateCreated !== date) throw new Error('Invalid date')
  let dateCompleted: string | null = null
  if (input.dateCompleted !== null && input.dateCompleted !== undefined) {
    dateCompleted = requireDateKey(input.dateCompleted)
  }
  let parentId: string | null = null
  if (input.parentId !== null && input.parentId !== undefined) parentId = requireId(input.parentId)
  if (parentId === id) throw new Error('Invalid task')
  if (input.side !== 'main' && input.side !== 'right') throw new Error('Invalid task')
  if (typeof input.done !== 'boolean') throw new Error('Invalid request')
  return {
    id,
    text: input.text === undefined ? '' : requireText(input.text),
    done: input.done,
    dateCreated,
    dateCompleted,
    parentId,
    x: requireCoordinate(input.x),
    y: requireCoordinate(input.y),
    side: input.side,
    orderIndex: requireInteger(input.orderIndex),
  }
}

export function parseReplaceDay(value: unknown): { date: string; tasks: Task[] } {
  const input = requireRecord(value)
  const date = requireDateKey(input.date)
  if (!Array.isArray(input.tasks) || input.tasks.length > 5_000) throw new Error('Invalid request')
  const tasks = input.tasks.map((item) => parseSnapshot(item, date))
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error('Invalid task')
  return { date, tasks }
}
