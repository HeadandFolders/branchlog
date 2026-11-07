import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isMenuAction,
  isTask,
  isTaskList,
  isWriteResult,
  type BranchlogApi,
  type CreateTaskInput,
  type UpdateTaskInput,
  type WriteResult,
} from '@shared/types'

const failed: WriteResult = { ok: false }

function readWriteResult(value: unknown): WriteResult {
  return isWriteResult(value) ? value : failed
}

const api: BranchlogApi = {
  tasks: {
    listByDate: async (date) => {
      const value: unknown = await ipcRenderer.invoke('tasks:listByDate', date)
      if (!isTaskList(value)) throw new Error('Could not complete that request')
      return value
    },
    createSync: (input: CreateTaskInput) => {
      return readWriteResult(ipcRenderer.sendSync('tasks:createSync', input))
    },
    update: async (input: UpdateTaskInput) => {
      const value: unknown = await ipcRenderer.invoke('tasks:update', input)
      if (!isTask(value)) throw new Error('Could not complete that request')
      return value
    },
    updateSync: (input: UpdateTaskInput) => {
      return readWriteResult(ipcRenderer.sendSync('tasks:updateSync', input))
    },
    delete: (id) => ipcRenderer.invoke('tasks:delete', id),
  },
  onMenuAction: (callback) => {
    const listener = (_event: IpcRendererEvent, action: unknown): void => {
      if (isMenuAction(action)) callback(action)
    }
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
}

contextBridge.exposeInMainWorld('branchlog', api)
