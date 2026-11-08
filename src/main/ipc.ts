import { ipcMain } from 'electron'
import { tempMark, tempMs } from '@shared/temp-timing'
import type { WriteResult } from '@shared/types'
import { createBranch, createTask, listTasksByDate, updateTask } from './database'
import { replaceDay } from './day-sync'
import { readSwipeToPan, writeSwipeToPan } from './settings'
import { deleteTask, restoreRemoved } from './task-tree'
import {
  parseCreateBranch,
  parseCreateTask,
  parseFlag,
  parseRemovedTasks,
  parseReplaceDay,
  parseUpdateTask,
  requireDateKey,
  requireId,
} from './validate'

function failure(error: unknown): WriteResult {
  console.error(error)
  return { ok: false }
}

let ipcCalls = 0

function watchIpc(): void {
  ipcCalls = 0
  const on = ipcMain.on.bind(ipcMain)
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.on = ((channel: string, listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void) => {
    return on(channel, (event, ...args: unknown[]) => {
      ipcCalls += 1
      listener(event, ...args)
    })
  }) as typeof ipcMain.on
  ipcMain.handle = ((
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => {
    return handle(channel, (event, ...args) => {
      ipcCalls += 1
      return listener(event, ...args)
    })
  }) as typeof ipcMain.handle
  ;(globalThis as { __branchlogIpcCalls?: () => number }).__branchlogIpcCalls = () => ipcCalls
}

export function installIpc(): void {
  watchIpc()
  ipcMain.handle('tasks:listByDate', (_event, payload: unknown) => {
    const handlerStart = performance.now()
    try {
      const validateStart = performance.now()
      const date = requireDateKey(payload)
      const validateMs = tempMs(validateStart)
      const queryStart = performance.now()
      const tasks = listTasksByDate(date)
      tempMark('ipc-listByDate', {
        handlerMs: tempMs(handlerStart),
        validateMs,
        queryMs: tempMs(queryStart),
        rows: tasks.length,
      })
      return tasks
    } catch (error) {
      console.error('tasks:listByDate', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) {
        throw new Error(error.message)
      }
      throw new Error('Could not complete that request')
    }
  })

  ipcMain.on('tasks:createSync', (event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:createSync' })
    try {
      event.returnValue = { ok: true, task: createTask(parseCreateTask(payload)) } satisfies WriteResult
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('tasks:createBranchSync', (event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:createBranchSync' })
    try {
      event.returnValue = { ok: true, task: createBranch(parseCreateBranch(payload)) } satisfies WriteResult
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.handle('tasks:update', (_event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:update' })
    try {
      return updateTask(parseUpdateTask(payload))
    } catch (error) {
      console.error('tasks:update', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) {
        throw new Error(error.message)
      }
      throw new Error('Could not complete that request')
    }
  })

  ipcMain.on('tasks:updateSync', (event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:updateSync' })
    try {
      event.returnValue = { ok: true, task: updateTask(parseUpdateTask(payload)) } satisfies WriteResult
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('tasks:replaceDay', (event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:replaceDay' })
    try {
      const input = parseReplaceDay(payload)
      replaceDay(input.date, input.tasks)
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('tasks:deleteSync', (event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:deleteSync' })
    try {
      event.returnValue = { ok: true, removed: deleteTask(requireId(payload)) }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('tasks:restore', (event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:restore' })
    try {
      restoreRemoved(parseRemovedTasks(payload))
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('settings:swipeToPan', (event) => {
    try {
      event.returnValue = readSwipeToPan()
    } catch (error) {
      console.error(error)
      event.returnValue = true
    }
  })

  ipcMain.on('settings:setSwipeToPan', (event, payload: unknown) => {
    try {
      writeSwipeToPan(parseFlag(payload))
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })
}
