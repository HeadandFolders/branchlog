import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { tempMark, tempMs } from '@shared/temp-timing'
import { themeBackground, type ThemeDocument } from '@shared/theme'
import type { ContinuationWriteResult, WriteResult } from '@shared/types'
import { createContinuation, listContinuations, searchEarlierTasks } from './continuation'
import { readAiSettings, writeAiSettings } from './ai-settings-store'
import { listModels } from './lm-studio'
import { createBranch, createTask, listActivityCounts, listTasksByDate, updateTask } from './database'
import { replaceDay } from './day-sync'
import { listImages, pasteImage, replaceImages, resizeImage } from './images'
import { commitLayout } from './layout-save'
import { readAutoSeparate, readSwipeToPan, writeAutoSeparate, writeSwipeToPan } from './settings'
import { readTheme, writeTheme } from './theme-store'
import { takeStartupCarry } from './carry-schedule'
import { deleteTask, restoreRemoved } from './task-tree'
import {
  parseAiBaseUrl,
  parseAiSettingsPayload,
  parseCreateBranch,
  parseCreateContinuation,
  parseCreateTask,
  parseEarlierQuery,
  parseImagePaste,
  parseImageReplace,
  parseImageSize,
  parseLayoutCommit,
  parseFlag,
  parseRemovedTasks,
  parseTheme,
  parseReplaceDay,
  parseUpdateTask,
  requireDateKey,
  requireId,
} from './validate'

function paintWindow(theme: ThemeDocument): void {
  const color = themeBackground(theme, nativeTheme.shouldUseDarkColors)
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(color)
}

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

  ipcMain.on('tasks:createContinuationSync', (event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:createContinuationSync' })
    try {
      const created = createContinuation(parseCreateContinuation(payload))
      event.returnValue = {
        ok: true,
        task: created.task,
        continuation: created.continuation,
      } satisfies ContinuationWriteResult
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.handle('tasks:continuations', (_event, payload: unknown) => {
    try {
      return listContinuations(requireDateKey(payload))
    } catch (error) {
      console.error('tasks:continuations', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) throw new Error(error.message)
      throw new Error('Could not complete that request')
    }
  })

  ipcMain.handle('tasks:searchEarlier', (_event, payload: unknown) => {
    try {
      return searchEarlierTasks(parseEarlierQuery(payload))
    } catch (error) {
      console.error('tasks:searchEarlier', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) throw new Error(error.message)
      throw new Error('Could not complete that request')
    }
  })

  ipcMain.handle('tasks:activityCounts', () => {
    try {
      return listActivityCounts()
    } catch (error) {
      console.error('tasks:activityCounts', error)
      throw new Error('Could not complete that request')
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

  ipcMain.handle('images:listByDate', (_event, payload: unknown) => {
    try {
      return listImages(requireDateKey(payload))
    } catch (error) {
      console.error('images:listByDate', error)
      throw new Error('Could not complete that request')
    }
  })

  ipcMain.handle('images:paste', async (_event, payload: unknown) => {
    try {
      return { ok: true, image: await pasteImage(parseImagePaste(payload)) }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.on('images:resize', (event, payload: unknown) => {
    try {
      resizeImage(parseImageSize(payload))
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('images:replace', (event, payload: unknown) => {
    try {
      const input = parseImageReplace(payload)
      replaceImages(input.date, input.images)
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('settings:autoSeparate', (event) => {
    try {
      event.returnValue = readAutoSeparate()
    } catch (error) {
      console.error(error)
      event.returnValue = true
    }
  })

  ipcMain.on('settings:theme', (event) => {
    try {
      event.returnValue = readTheme()
    } catch (error) {
      console.error(error)
      event.returnValue = null
    }
  })

  ipcMain.on('settings:setTheme', (event, payload: unknown) => {
    try {
      const theme = parseTheme(payload)
      writeTheme(theme)
      paintWindow(theme)
      event.returnValue = { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the theme.'
      console.error(error)
      event.returnValue = { ok: false, message }
    }
  })

  ipcMain.on('settings:setAutoSeparate', (event, payload: unknown) => {
    try {
      if (typeof payload !== 'boolean') throw new Error('Invalid request')
      writeAutoSeparate(payload)
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

  ipcMain.on('layout:commit', (event, payload: unknown) => {
    try {
      commitLayout(parseLayoutCommit(payload))
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('ai:settings', (event) => {
    try {
      event.returnValue = readAiSettings()
    } catch (error) {
      console.error(error)
      event.returnValue = null
    }
  })

  ipcMain.on('ai:setSettings', (event, payload: unknown) => {
    try {
      writeAiSettings(parseAiSettingsPayload(payload))
      event.returnValue = { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the AI settings.'
      console.error(error)
      event.returnValue = { ok: false, message }
    }
  })

  ipcMain.handle('ai:testConnection', async (_event, payload: unknown) => {
    let baseUrl: string
    try {
      baseUrl = parseAiBaseUrl(payload)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Invalid AI address' }
    }
    return listModels(baseUrl)
  })

  ipcMain.on('carry:ready', (event) => {
    try {
      event.returnValue = takeStartupCarry()
    } catch (error) {
      console.error(error)
      event.returnValue = { ok: false }
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
}
