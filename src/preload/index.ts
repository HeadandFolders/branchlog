import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { tempMark, tempMs } from '@shared/temp-timing'
import { defaultTheme, parseThemeDocument, type ThemeDocument } from '@shared/theme'
import {
  isAck,
  isCanvasImageList,
  isDeleteResult,
  isImageResult,
  isMenuAction,
  isTask,
  isTaskList,
  isWriteResult,
  type Ack,
  type BranchlogApi,
  type CreateBranchInput,
  type CreateTaskInput,
  type DeleteResult,
  type ImagePasteInput,
  type ImageRecord,
  type ImageResult,
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
      if (!isTaskList(value)) throw new Error('Could not complete that request')
      return value
    },
    createSync: (input: CreateTaskInput) => {
      return readWriteResult(ipcRenderer.sendSync('tasks:createSync', input))
    },
    createBranchSync: (input: CreateBranchInput) => {
      return readWriteResult(ipcRenderer.sendSync('tasks:createBranchSync', input))
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
    replaceSync: (date: string, images: ImageRecord[]): Ack => {
      const value: unknown = ipcRenderer.sendSync('images:replace', { date, images })
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
}

contextBridge.exposeInMainWorld('branchlog', api)
tempMark('preload-end')
