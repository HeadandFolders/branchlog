import { ipcMain } from 'electron'
import type { WriteResult } from '@shared/types'
import { createBranch, createTask, deleteTask, listTasksByDate, updateTask } from './database'
import { replaceDay } from './day-sync'
import { parseCreateBranch, parseCreateTask, parseReplaceDay, parseUpdateTask, requireDateKey, requireId } from './validate'

function failure(error: unknown): WriteResult {
  console.error(error)
  return { ok: false }
}

export function installIpc(): void {
  ipcMain.handle('tasks:listByDate', (_event, payload: unknown) => {
    try {
      return listTasksByDate(requireDateKey(payload))
    } catch (error) {
      console.error('tasks:listByDate', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) {
        throw new Error(error.message)
      }
      throw new Error('Could not complete that request')
    }
  })

  ipcMain.on('tasks:createSync', (event, payload: unknown) => {
    try {
      event.returnValue = { ok: true, task: createTask(parseCreateTask(payload)) } satisfies WriteResult
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('tasks:createBranchSync', (event, payload: unknown) => {
    try {
      event.returnValue = { ok: true, task: createBranch(parseCreateBranch(payload)) } satisfies WriteResult
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.handle('tasks:update', (_event, payload: unknown) => {
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
    try {
      event.returnValue = { ok: true, task: updateTask(parseUpdateTask(payload)) } satisfies WriteResult
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('tasks:replaceDay', (event, payload: unknown) => {
    try {
      const input = parseReplaceDay(payload)
      replaceDay(input.date, input.tasks)
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.handle('tasks:delete', (_event, payload: unknown) => {
    try {
      deleteTask(requireId(payload))
    } catch (error) {
      console.error('tasks:delete', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) {
        throw new Error(error.message)
      }
      throw new Error('Could not complete that request')
    }
  })
}
