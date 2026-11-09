import { parseAiSettings, parseBaseUrl, type AiSettings } from '@shared/ai-settings'
import { BRANCH_MIN_WIDTH } from '@shared/branch-size'
import { parseThemeDocument, type ThemeDocument } from '@shared/theme'
import { parseRemovedComments } from './ai-validate'
import type {
  CarryLink,
  CreateBranchInput,
  CreateContinuationInput,
  CreateTaskInput,
  ImageCrop,
  ImageDropInput,
  ImagePasteInput,
  ImageRecord,
  ImageSizeInput,
  LayoutCommit,
  LayoutPoint,
  MapPosition,
  RemovedTasks,
  Task,
  UpdateTaskInput,
} from '@shared/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_TEXT = 20_000
const MAX_DROP_BYTES = 64 * 1024 * 1024
const MAX_CROP = 0.95

export function requireRecord(value: unknown): Record<string, unknown> {
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

export function requireCoordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -100_000 || value > 100_000) {
    throw new Error('Invalid position')
  }
  return value
}

function requireSize(value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > 8_000) {
    throw new Error('Invalid size')
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

export function parseCreateContinuation(value: unknown): CreateContinuationInput {
  const input = requireRecord(value)
  const id = requireId(input.id)
  const parentId = requireId(input.parentId)
  if (id === parentId) throw new Error('Invalid task')
  return {
    id,
    parentId,
    text: input.text === undefined ? '' : requireText(input.text),
  }
}

export function parseEarlierQuery(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  return requireText(value)
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
  if ('width' in input && input.width !== undefined) result.width = requireSize(input.width, BRANCH_MIN_WIDTH)
  if ('height' in input && input.height !== undefined) result.height = requireSize(input.height, 0)
  if (
    result.text === undefined &&
    result.done === undefined &&
    result.x === undefined &&
    result.y === undefined &&
    result.width === undefined &&
    result.height === undefined
  ) {
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

function parseCarryColumns(
  input: Record<string, unknown>,
  id: string,
): { carriedFromId: string | null; chainId: string; droppedAt: string | null } {
  const chainId = requireId(input.chainId)
  let carriedFromId: string | null = null
  if (input.carriedFromId !== null && input.carriedFromId !== undefined) {
    carriedFromId = requireId(input.carriedFromId)
    if (carriedFromId === id) throw new Error('Invalid task')
  }
  let droppedAt: string | null = null
  if (input.droppedAt !== null && input.droppedAt !== undefined) droppedAt = requireDateKey(input.droppedAt)
  return { carriedFromId, chainId, droppedAt }
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
    width: requireSize(input.width, BRANCH_MIN_WIDTH),
    height: requireSize(input.height, 0),
    side: input.side,
    orderIndex: requireInteger(input.orderIndex),
    ...parseCarryColumns(input, id),
  }
}

function parseRemovedTask(value: unknown): Task {
  const input = requireRecord(value)
  const id = requireId(input.id)
  const dateCreated = requireDateKey(input.dateCreated)
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
    width: requireSize(input.width, BRANCH_MIN_WIDTH),
    height: requireSize(input.height, 0),
    side: input.side,
    orderIndex: requireInteger(input.orderIndex),
    ...parseCarryColumns(input, id),
  }
}

function parseMapPosition(value: unknown, taskIds: Set<string>): MapPosition {
  const input = requireRecord(value)
  const taskId = requireId(input.taskId)
  if (!taskIds.has(taskId)) throw new Error('Invalid task')
  return { taskId, x: requireCoordinate(input.x), y: requireCoordinate(input.y) }
}

export function parseRemovedTasks(value: unknown): RemovedTasks {
  const input = requireRecord(value)
  if (!Array.isArray(input.tasks) || input.tasks.length === 0 || input.tasks.length > 5_000) {
    throw new Error('Invalid request')
  }
  if (!Array.isArray(input.mapPositions) || input.mapPositions.length > 5_000) {
    throw new Error('Invalid request')
  }
  if (!Array.isArray(input.carryLinks) || input.carryLinks.length > 5_000) throw new Error('Invalid request')
  if (!Array.isArray(input.comments) || input.comments.length > 5_000) throw new Error('Invalid request')
  const tasks = input.tasks.map(parseRemovedTask)
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error('Invalid task')
  const taskIds = new Set(tasks.map((task) => task.id))
  const mapPositions = input.mapPositions.map((position) => parseMapPosition(position, taskIds))
  if (new Set(mapPositions.map((position) => position.taskId)).size !== mapPositions.length) {
    throw new Error('Invalid task')
  }
  const carryLinks = input.carryLinks.map(parseCarryLink)
  if (new Set(carryLinks.map((link) => link.id)).size !== carryLinks.length) throw new Error('Invalid task')
  const removedComments = parseRemovedComments({ comments: input.comments })
  for (const comment of removedComments.comments) {
    if (!taskIds.has(comment.taskId)) throw new Error('Invalid task')
  }
  return { tasks, mapPositions, carryLinks, comments: removedComments.comments }
}

function parseCarryLink(value: unknown): CarryLink {
  const input = requireRecord(value)
  const id = requireId(input.id)
  let carriedFromId: string | null = null
  if (input.carriedFromId !== null && input.carriedFromId !== undefined) {
    carriedFromId = requireId(input.carriedFromId)
  }
  return { id, carriedFromId }
}

function parseLayoutPoint(value: unknown): LayoutPoint {
  const input = requireRecord(value)
  return { id: requireId(input.id), x: requireCoordinate(input.x), y: requireCoordinate(input.y) }
}

export function parseLayoutCommit(value: unknown): LayoutCommit {
  const input = requireRecord(value)
  if (!Array.isArray(input.tasks) || !Array.isArray(input.images) || !Array.isArray(input.comments)) {
    throw new Error('Invalid position')
  }
  const total = input.tasks.length + input.images.length + input.comments.length
  if (total === 0 || input.tasks.length > 500 || input.images.length > 500 || input.comments.length > 500) {
    throw new Error('Invalid position')
  }
  const tasks = input.tasks.map(parseLayoutPoint)
  const images = input.images.map(parseLayoutPoint)
  const comments = input.comments.map(parseLayoutPoint)
  if (new Set(tasks.map((point) => point.id)).size !== tasks.length) throw new Error('Invalid task')
  if (new Set(images.map((point) => point.id)).size !== images.length) throw new Error('Invalid image')
  if (new Set(comments.map((point) => point.id)).size !== comments.length) throw new Error('Invalid comment')
  return { tasks, images, comments }
}

export function parseImagePaste(value: unknown): ImagePasteInput {
  const input = requireRecord(value)
  return {
    id: requireId(input.id),
    dateKey: requireDateKey(input.dateKey),
    x: requireCoordinate(input.x),
    y: requireCoordinate(input.y),
  }
}

function requireCropFraction(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_CROP) {
    throw new Error('Invalid crop')
  }
  return value
}

function parseCrop(input: Record<string, unknown>): ImageCrop {
  const cropLeft = requireCropFraction(input.cropLeft)
  const cropTop = requireCropFraction(input.cropTop)
  const cropRight = requireCropFraction(input.cropRight)
  const cropBottom = requireCropFraction(input.cropBottom)
  if (cropLeft + cropRight > MAX_CROP || cropTop + cropBottom > MAX_CROP) {
    throw new Error('Invalid crop')
  }
  return { cropLeft, cropTop, cropRight, cropBottom }
}

export function parseImageSize(value: unknown): ImageSizeInput {
  const input = requireRecord(value)
  return {
    id: requireId(input.id),
    x: requireCoordinate(input.x),
    y: requireCoordinate(input.y),
    width: requireSize(input.width, 1),
    height: requireSize(input.height, 1),
    ...parseCrop(input),
  }
}

export function parseImageDrop(value: unknown): ImageDropInput {
  const input = requireRecord(value)
  const raw = input.bytes
  const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_DROP_BYTES) throw new Error('Invalid image')
  return {
    id: requireId(input.id),
    dateKey: requireDateKey(input.dateKey),
    x: requireCoordinate(input.x),
    y: requireCoordinate(input.y),
    bytes,
  }
}

function parseImageRecord(value: unknown, date: string): ImageRecord {
  const input = requireRecord(value)
  const dateKey = requireDateKey(input.dateKey)
  if (dateKey !== date) throw new Error('Invalid date')
  const fileName = input.fileName
  if (typeof fileName !== 'string' || !/^[0-9a-f-]{36}\.png$/i.test(fileName)) throw new Error('Invalid image')
  return {
    id: requireId(input.id),
    dateKey,
    fileName,
    x: requireCoordinate(input.x),
    y: requireCoordinate(input.y),
    width: requireSize(input.width, 1),
    height: requireSize(input.height, 1),
    ...parseCrop(input),
  }
}

export function parseImageReplace(value: unknown): { date: string; images: ImageRecord[] } {
  const input = requireRecord(value)
  const date = requireDateKey(input.date)
  if (!Array.isArray(input.images) || input.images.length > 500) throw new Error('Invalid image')
  const images = input.images.map((item) => parseImageRecord(item, date))
  if (new Set(images.map((image) => image.id)).size !== images.length) throw new Error('Invalid image')
  return { date, images }
}

export function parseImageDelete(value: unknown): string[] {
  const input = requireRecord(value)
  if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 500) {
    throw new Error('Invalid image')
  }
  const ids = input.ids.map((item: unknown) => requireId(item))
  if (new Set(ids).size !== ids.length) throw new Error('Invalid image')
  return ids
}

export function parseTheme(value: unknown): ThemeDocument {
  return parseThemeDocument(value)
}

export function parseAiSettingsPayload(value: unknown): AiSettings {
  return parseAiSettings(value)
}

export function parseAiBaseUrl(value: unknown): string {
  return parseBaseUrl(value)
}

export function parseFlag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid request')
  return value
}

export function parseReplaceDay(value: unknown): { date: string; tasks: Task[] } {
  const input = requireRecord(value)
  const date = requireDateKey(input.date)
  if (!Array.isArray(input.tasks) || input.tasks.length > 5_000) throw new Error('Invalid request')
  const tasks = input.tasks.map((item) => parseSnapshot(item, date))
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error('Invalid task')
  return { date, tasks }
}

export {
  parseAiCancel,
  parseAskAiInput,
  parseCommentReplace,
  parseCommentReply,
  parseCommentRequest,
  parseCommentStatus,
  parseKeptRangesInput,
  parseRemovedComments,
} from './ai-validate'
