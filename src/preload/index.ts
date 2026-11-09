import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isAiCommentDeleteResult,
  isAiCommentResult,
  isAiCommentWriteResult,
  isAiReplyResult,
  type AiComment,
  type AiCommentDeleteResult,
  type AiCommentResult,
  type AiCommentWriteResult,
  type AiReplyResult,
  type AskAiInput,
  type CommentReplyInput,
  type CommentRequest,
  type KeptRangesInput,
  type RemovedComments,
} from '@shared/ai-comments'
import { defaultAiSettings, parseAiSettings, type AiSettings } from '@shared/ai-settings'
import { tempMark, tempMs } from '@shared/temp-timing'
import { defaultTheme, parseThemeDocument, type ThemeDocument } from '@shared/theme'
import {
  isAck,
  isActivityCountList,
  isAiConnectionResult,
  isCanvasImageList,
  isCarryRun,
  isCarryRunList,
  isContinuationList,
  isContinuationWriteResult,
  isDayLoad,
  isDeleteResult,
  isEarlierTaskList,
  isImageResult,
  isMenuAction,
  isTask,
  isWriteResult,
  type Ack,
  type AiConnectionResult,
  type BranchlogApi,
  type CarryRun,
  type ContinuationWriteResult,
  type CreateBranchInput,
  type CreateContinuationInput,
  type CreateTaskInput,
  type DeleteResult,
  type ImageDeleteInput,
  type ImageDropInput,
  type ImagePasteInput,
  type ImageRecord,
  type ImageResult,
  type ImageSizeInput,
  type LayoutCommit,
  type RemovedTasks,
  type Task,
  type ThemeWriteResult,
  type UpdateTaskInput,
  type WriteResult,
} from '@shared/types'
import { bootTheme } from './theme-boot'

tempMark('preload-start')
bootTheme()

const failed: WriteResult = { ok: false }
const deleteFailed: DeleteResult = { ok: false }

function readWriteResult(value: unknown): WriteResult {
  return isWriteResult(value) ? value : failed
}

function readTheme(): ThemeDocument {
  try {
    return parseThemeDocument(ipcRenderer.sendSync('settings:theme'))
  } catch (error) {
    console.error(error)
    return defaultTheme()
  }
}

const api: BranchlogApi = {
  tasks: {
    listByDate: async (date) => {
      tempMark('ipc-send', { channel: 'tasks:listByDate' })
      const started = performance.now()
      const value: unknown = await ipcRenderer.invoke('tasks:listByDate', date)
      tempMark('ipc-recv', { channel: 'tasks:listByDate', roundTripMs: tempMs(started) })
      if (!isDayLoad(value)) throw new Error('Could not complete that request')
      return value
    },
    createSync: (input: CreateTaskInput) => {
      return readWriteResult(ipcRenderer.sendSync('tasks:createSync', input))
    },
    createBranchSync: (input: CreateBranchInput) => {
      return readWriteResult(ipcRenderer.sendSync('tasks:createBranchSync', input))
    },
    createContinuationSync: (input: CreateContinuationInput): ContinuationWriteResult => {
      const value: unknown = ipcRenderer.sendSync('tasks:createContinuationSync', input)
      return isContinuationWriteResult(value) ? value : { ok: false }
    },
    continuations: async (date) => {
      const value: unknown = await ipcRenderer.invoke('tasks:continuations', date)
      if (!isContinuationList(value)) throw new Error('Could not complete that request')
      return value
    },
    searchEarlier: async (query) => {
      const value: unknown = await ipcRenderer.invoke('tasks:searchEarlier', query)
      if (!isEarlierTaskList(value)) throw new Error('Could not complete that request')
      return value
    },
    update: async (input: UpdateTaskInput) => {
      const value: unknown = await ipcRenderer.invoke('tasks:update', input)
      if (!isTask(value)) throw new Error('Could not complete that request')
      return value
    },
    updateSync: (input: UpdateTaskInput) => {
      return readWriteResult(ipcRenderer.sendSync('tasks:updateSync', input))
    },
    replaceDaySync: (date: string, tasks: Task[]): Ack => {
      const value: unknown = ipcRenderer.sendSync('tasks:replaceDay', { date, tasks })
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
    deleteSync: (id) => {
      const value: unknown = ipcRenderer.sendSync('tasks:deleteSync', id)
      return isDeleteResult(value) ? value : deleteFailed
    },
    restoreSync: (removed: RemovedTasks): Ack => {
      const value: unknown = ipcRenderer.sendSync('tasks:restore', removed)
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
    activityCounts: async () => {
      const value: unknown = await ipcRenderer.invoke('tasks:activityCounts')
      if (!isActivityCountList(value)) throw new Error('Could not complete that request')
      return value
    },
  },
  images: {
    listByDate: async (date) => {
      const value: unknown = await ipcRenderer.invoke('images:listByDate', date)
      if (!isCanvasImageList(value)) throw new Error('Could not complete that request')
      return value
    },
    paste: async (input: ImagePasteInput): Promise<ImageResult> => {
      const value: unknown = await ipcRenderer.invoke('images:paste', input)
      return isImageResult(value) ? value : { ok: false }
    },
    drop: async (input: ImageDropInput): Promise<ImageResult> => {
      const value: unknown = await ipcRenderer.invoke('images:drop', input)
      return isImageResult(value) ? value : { ok: false }
    },
    resizeSync: (input: ImageSizeInput): Ack => {
      const value: unknown = ipcRenderer.sendSync('images:resize', input)
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
    replaceSync: (date: string, images: ImageRecord[]): Ack => {
      const value: unknown = ipcRenderer.sendSync('images:replace', { date, images })
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
    deleteSync: (input: ImageDeleteInput): Ack => {
      const value: unknown = ipcRenderer.sendSync('images:delete', input)
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
  },
  settings: {
    autoSeparate: () => ipcRenderer.sendSync('settings:autoSeparate') === true,
    setAutoSeparate: (on: boolean): Ack => {
      const value: unknown = ipcRenderer.sendSync('settings:setAutoSeparate', on)
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
    swipeToPan: () => ipcRenderer.sendSync('settings:swipeToPan') === true,
    setSwipeToPan: (on: boolean): Ack => {
      const value: unknown = ipcRenderer.sendSync('settings:setSwipeToPan', on)
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
    theme: () => readTheme(),
    setTheme: (theme: ThemeDocument): ThemeWriteResult => {
      const value: unknown = ipcRenderer.sendSync('settings:setTheme', theme)
      if (typeof value === 'object' && value !== null && 'ok' in value && (value as { ok: unknown }).ok === true) {
        return { ok: true }
      }
      const message =
        typeof value === 'object' && value !== null && 'message' in value && typeof (value as { message: unknown }).message === 'string'
          ? (value as { message: string }).message
          : 'Could not save the theme.'
      return { ok: false, message }
    },
  },
  layout: {
    commitSync: (input: LayoutCommit): Ack => {
      const value: unknown = ipcRenderer.sendSync('layout:commit', input)
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
  },
  ai: {
    settings: (): AiSettings => {
      try {
        return parseAiSettings(ipcRenderer.sendSync('ai:settings'))
      } catch (error) {
        console.error(error)
        return defaultAiSettings()
      }
    },
    setSettings: (settings: AiSettings): ThemeWriteResult => {
      const value: unknown = ipcRenderer.sendSync('ai:setSettings', settings)
      if (typeof value === 'object' && value !== null && 'ok' in value && (value as { ok: unknown }).ok === true) {
        return { ok: true }
      }
      const message =
        typeof value === 'object' && value !== null && 'message' in value && typeof (value as { message: unknown }).message === 'string'
          ? (value as { message: string }).message
          : 'Could not save the AI settings.'
      return { ok: false, message }
    },
    testConnection: async (baseUrl: string): Promise<AiConnectionResult> => {
      const value: unknown = await ipcRenderer.invoke('ai:testConnection', baseUrl)
      if (!isAiConnectionResult(value)) return { ok: false, message: 'Could not complete that request' }
      return value
    },
    requestComment: async (input: CommentRequest): Promise<AiCommentResult> => {
      const value: unknown = await ipcRenderer.invoke('ai:requestComment', input)
      return isAiCommentResult(value) ? value : { kind: 'none' }
    },
    ask: async (input: AskAiInput): Promise<AiCommentResult> => {
      const value: unknown = await ipcRenderer.invoke('ai:ask', input)
      return isAiCommentResult(value) ? value : { kind: 'none' }
    },
    cancel: (requestId: string): void => {
      ipcRenderer.send('ai:cancel', requestId)
    },
    reply: async (input: CommentReplyInput): Promise<AiReplyResult> => {
      const value: unknown = await ipcRenderer.invoke('ai:reply', input)
      return isAiReplyResult(value) ? value : { kind: 'none' }
    },
    setCommentStatusSync: (id: string, status: 'open' | 'resolved'): AiCommentWriteResult => {
      const value: unknown = ipcRenderer.sendSync('ai:setCommentStatus', { id, status })
      return isAiCommentWriteResult(value) ? value : { ok: false }
    },
    setKeptRangesSync: (input: KeptRangesInput): AiCommentWriteResult => {
      const value: unknown = ipcRenderer.sendSync('ai:setKeptRanges', input)
      return isAiCommentWriteResult(value) ? value : { ok: false }
    },
    deleteCommentSync: (id: string): AiCommentDeleteResult => {
      const value: unknown = ipcRenderer.sendSync('ai:deleteComment', id)
      return isAiCommentDeleteResult(value) ? value : { ok: false }
    },
    restoreCommentsSync: (removed: RemovedComments): Ack => {
      const value: unknown = ipcRenderer.sendSync('ai:restoreComments', removed)
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
    replaceCommentsSync: (date: string, comments: AiComment[]): Ack => {
      const value: unknown = ipcRenderer.sendSync('ai:replaceComments', { date, comments })
      if (!isAck(value) || !value.ok) return { ok: false }
      return { ok: true }
    },
  },
  onMenuAction: (callback) => {
    const listener = (_event: IpcRendererEvent, action: unknown): void => {
      if (isMenuAction(action)) callback(action)
    }
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
  onResume: (callback) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on('clock:resume', listener)
    return () => ipcRenderer.removeListener('clock:resume', listener)
  },
  carry: {
    ready: (): CarryRun[] => {
      const value: unknown = ipcRenderer.sendSync('carry:ready')
      if (!isCarryRunList(value)) throw new Error('Could not carry unfinished tasks.')
      return value
    },
    onApplied: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: unknown): void => {
        if (isCarryRun(payload)) callback(payload)
      }
      ipcRenderer.on('carry:applied', listener)
      return () => ipcRenderer.removeListener('carry:applied', listener)
    },
  },
}

contextBridge.exposeInMainWorld('branchlog', api)
tempMark('preload-end')
