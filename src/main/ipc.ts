import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { tempMark, tempMs } from '@shared/temp-timing'
import { themeBackground, type ThemeDocument } from '@shared/theme'
import { DEFAULT_BRIEFS_MAX_CHARS, type BriefResult } from '@shared/ai-briefs'
import type { Ack, ContinuationWriteResult, WriteResult } from '@shared/types'
import { createContinuation, listContinuations, searchEarlierTasks } from './continuation'
import { installAiRequestIpc } from './ai-request-ipc'
import { cancelAiFlights } from './ai-flight'
import { readAiSettings, writeAiSettings } from './ai-settings-store'
import {
  deleteBrief,
  listCommentsByDate,
  removeComment,
  replaceComments,
  restoreCommentsOn,
  setBriefAlwaysInclude,
  setBriefEnabled,
  setCommentProject,
  setCommentStatus,
  setKeptRanges,
} from './ai-store'
import { briefErrorMessage, linkFiles, linkFolder, listBriefViews, refreshBrief } from './briefs'
import { readDayNote, writeDayNote } from './day-note'
import { getDatabase } from './database'
import { listModels } from './lm-studio'
import { createBranch, createTask, getTask, listActivityCounts, listTasksByDate, updateTask } from './database'
import { dropTask, readAutoCarry, undropTask, writeAutoCarry } from './carry'
import { replaceDay } from './day-sync'
import { deleteImages, dropImage, listImages, pasteImage, replaceImages, resizeImage } from './images'
import { commitLayout } from './layout-save'
import { loadMapData, saveMapPositions } from './map-data'
import {
  readAutoSeparate,
  readBriefsMaxChars,
  readHighlightCarried,
  readMapExpandChains,
  readSwipeToPan,
  writeAutoSeparate,
  writeBriefsMaxChars,
  writeHighlightCarried,
  writeMapExpandChains,
  writeSwipeToPan,
} from './settings'
import { readTheme, writeTheme } from './theme-store'
import { carryOnDemand, takeStartupCarry } from './carry-schedule'
import { listTaskChainStates } from './task-state'
import { deleteTask, restoreRemoved } from './task-tree'
import {
  parseAiBaseUrl,
  parseAiSettingsPayload,
  parseBriefFlag,
  parseBriefId,
  parseBriefsMaxChars,
  parseCommentReplace,
  parseCommentProject,
  parseCommentStatus,
  parseCreateBranch,
  parseCreateContinuation,
  parseCreateTask,
  parseDayNoteWrite,
  parseEarlierQuery,
  parseImageDelete,
  parseImageDrop,
  parseImagePaste,
  parseImageReplace,
  parseImageSize,
  parseKeptRangesInput,
  parseLayoutCommit,
  parseFlag,
  parseMapPositions,
  parseRemovedComments,
  parseRemovedTasks,
  parseTaskDrop,
  parseTheme,
  parseReplaceDay,
  parseTaskIds,
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

function writeBriefResult(run: () => void): BriefResult {
  try {
    run()
    return { ok: true }
  } catch (error) {
    console.error(error)
    return { ok: false, message: briefErrorMessage(error) }
  }
}

async function openBriefsDialog(
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions,
): Promise<string[]> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
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
      const comments = listCommentsByDate(date)
      tempMark('ipc-listByDate', {
        handlerMs: tempMs(handlerStart),
        validateMs,
        queryMs: tempMs(queryStart),
        rows: tasks.length,
      })
      return { tasks, comments }
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

  ipcMain.handle('tasks:chainStates', (_event, payload: unknown) => {
    try {
      return listTaskChainStates(parseTaskIds(payload))
    } catch (error) {
      console.error('tasks:chainStates', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) throw new Error(error.message)
      throw new Error('Could not complete that request')
    }
  })

  ipcMain.handle('map:load', () => {
    try {
      return loadMapData()
    } catch (error) {
      console.error('map:load', error)
      throw new Error(error instanceof Error ? error.message : 'Could not load the concept map')
    }
  })

  ipcMain.handle('map:savePositions', (_event, payload: unknown) => {
    try {
      saveMapPositions(parseMapPositions(payload))
      return { ok: true }
    } catch (error) {
      console.error('map:savePositions', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) throw new Error(error.message)
      return { ok: false }
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

  ipcMain.handle('tasks:setDropped', (_event, payload: unknown) => {
    tempMark('ipc-call', { channel: 'tasks:setDropped' })
    try {
      const input = parseTaskDrop(payload)
      const db = getDatabase()
      if (input.dropped) dropTask(db, input.id)
      else undropTask(db, input.id)
      const task = getTask(input.id)
      if (!task) throw new Error('Invalid task')
      return task
    } catch (error) {
      console.error('tasks:setDropped', error)
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
      const removal = deleteTask(requireId(payload))
      event.returnValue = { ok: true, removed: removal.removed, willCarry: removal.willCarry }
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

  ipcMain.handle('images:drop', (_event, payload: unknown) => {
    try {
      return { ok: true, image: dropImage(parseImageDrop(payload)) }
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

  ipcMain.on('images:delete', (event, payload: unknown) => {
    try {
      deleteImages(parseImageDelete(payload))
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

  ipcMain.on('settings:autoCarry', (event) => {
    try {
      event.returnValue = readAutoCarry(getDatabase())
    } catch (error) {
      console.error(error)
      event.returnValue = true
    }
  })

  ipcMain.on('settings:setAutoCarry', (event, payload: unknown) => {
    try {
      const on = parseFlag(payload)
      writeAutoCarry(getDatabase(), on)
      event.returnValue = { ok: true }
      if (on) carryOnDemand()
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('settings:highlightCarried', (event) => {
    try {
      event.returnValue = readHighlightCarried()
    } catch (error) {
      console.error(error)
      event.returnValue = true
    }
  })

  ipcMain.on('settings:setHighlightCarried', (event, payload: unknown) => {
    try {
      writeHighlightCarried(parseFlag(payload))
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('settings:mapExpandChains', (event) => {
    try {
      event.returnValue = readMapExpandChains()
    } catch (error) {
      console.error(error)
      event.returnValue = false
    }
  })

  ipcMain.on('settings:setMapExpandChains', (event, payload: unknown) => {
    try {
      writeMapExpandChains(parseFlag(payload))
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
      const before = readAiSettings()
      const settings = parseAiSettingsPayload(payload)
      writeAiSettings(settings)
      if (!settings.enabled || settings.baseUrl !== before.baseUrl || settings.model !== before.model) cancelAiFlights()
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

  installAiRequestIpc()

  ipcMain.on('ai:setCommentStatus', (event, payload: unknown) => {
    try {
      const input = parseCommentStatus(payload)
      event.returnValue = { ok: true, comment: setCommentStatus(input.id, input.status) }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('ai:setCommentProject', (event, payload: unknown) => {
    try {
      const input = parseCommentProject(payload)
      event.returnValue = { ok: true, comment: setCommentProject(input.commentId, input.projectId) }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('ai:setKeptRanges', (event, payload: unknown) => {
    try {
      const input = parseKeptRangesInput(payload)
      event.returnValue = { ok: true, comment: setKeptRanges(input.commentId, input.replyId, input.keptRanges) }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('ai:deleteComment', (event, payload: unknown) => {
    try {
      event.returnValue = { ok: true, removed: removeComment(requireId(payload)) }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('ai:restoreComments', (event, payload: unknown) => {
    try {
      const removed = parseRemovedComments(payload)
      const db = getDatabase()
      db.transaction(() => restoreCommentsOn(db, removed))()
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.on('ai:replaceComments', (event, payload: unknown) => {
    try {
      const input = parseCommentReplace(payload)
      replaceComments(input.date, input.comments)
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.handle('briefs:list', () => {
    try {
      return listBriefViews()
    } catch (error) {
      console.error('briefs:list', error)
      throw new Error('Could not load the briefs')
    }
  })

  ipcMain.handle('briefs:linkFolder', async (event) => {
    try {
      const picked = await openBriefsDialog(event, {
        title: 'Link a folder of briefs',
        buttonLabel: 'Link folder',
        properties: ['openDirectory'],
      })
      if (picked.length === 0) return { ok: true, briefs: [] } satisfies BriefResult
      return { ok: true, briefs: linkFolder(picked[0]) } satisfies BriefResult
    } catch (error) {
      return { ok: false, message: briefErrorMessage(error) } satisfies BriefResult
    }
  })

  ipcMain.handle('briefs:linkFiles', async (event) => {
    try {
      const picked = await openBriefsDialog(event, {
        title: 'Link brief files',
        buttonLabel: 'Link briefs',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      })
      if (picked.length === 0) return { ok: true, briefs: [] } satisfies BriefResult
      return { ok: true, briefs: linkFiles(picked) } satisfies BriefResult
    } catch (error) {
      return { ok: false, message: briefErrorMessage(error) } satisfies BriefResult
    }
  })

  ipcMain.handle('briefs:refresh', (_event, payload: unknown) => {
    return writeBriefResult(() => refreshBrief(parseBriefId(payload)))
  })

  ipcMain.handle('briefs:setEnabled', (_event, payload: unknown) => {
    const input = parseBriefFlag(payload)
    return writeBriefResult(() => setBriefEnabled(input.id, input.on))
  })

  ipcMain.handle('briefs:setAlwaysInclude', (_event, payload: unknown) => {
    const input = parseBriefFlag(payload)
    return writeBriefResult(() => setBriefAlwaysInclude(input.id, input.on))
  })

  ipcMain.handle('briefs:remove', (_event, payload: unknown) => {
    return writeBriefResult(() => deleteBrief(parseBriefId(payload)))
  })

  ipcMain.on('briefs:maxChars', (event) => {
    try {
      event.returnValue = readBriefsMaxChars()
    } catch (error) {
      console.error(error)
      event.returnValue = DEFAULT_BRIEFS_MAX_CHARS
    }
  })

  ipcMain.on('briefs:setMaxChars', (event, payload: unknown) => {
    try {
      writeBriefsMaxChars(parseBriefsMaxChars(payload))
      event.returnValue = { ok: true }
    } catch (error) {
      event.returnValue = failure(error)
    }
  })

  ipcMain.handle('dayNote:get', (_event, payload: unknown) => {
    try {
      return readDayNote(requireDateKey(payload))
    } catch (error) {
      console.error('dayNote:get', error)
      if (error instanceof Error && error.message.startsWith('Invalid')) throw new Error(error.message)
      throw new Error('Could not complete that request')
    }
  })

  ipcMain.on('dayNote:set', (event, payload: unknown) => {
    try {
      const input = parseDayNoteWrite(payload)
      writeDayNote(input.dateKey, input.text)
      event.returnValue = { ok: true } satisfies Ack
    } catch (error) {
      event.returnValue = failure(error)
    }
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
