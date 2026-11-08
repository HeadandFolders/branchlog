import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isAck,
  isDeleteResult,
  isMenuAction,
  isTask,
  isTaskList,
  isWriteResult,
  type Ack,
  type BranchlogApi,
  type CreateBranchInput,
  type CreateTaskInput,
  type DeleteResult,
  type RemovedTasks,
  type Task,
  type UpdateTaskInput,
  type WriteResult,
} from '@shared/types'

const failed: WriteResult = { ok: false }
const deleteFailed: DeleteResult = { ok: false }

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
  onMenuAction: (callback) => {
    const listener = (_event: IpcRendererEvent, action: unknown): void => {
      if (isMenuAction(action)) callback(action)
    }
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
}

contextBridge.exposeInMainWorld('branchlog', api)
