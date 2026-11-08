import { app, BrowserWindow, nativeTheme, powerMonitor } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { testNowSetting } from '@shared/dates'
import { defaultTheme, themeBackground } from '@shared/theme'
import { setTempLog, tempMark, tempMs } from '@shared/temp-timing'
import { finishBackup, startDailyBackup } from './backup'
import { closeDatabase, initDatabase } from './database'
import { installIpc } from './ipc'
import { installMenu } from './menu'
import { installEditContextMenu } from './context-menu'
import { contentSecurityHeaderChecks, hardenContents, installSecurityPolicy } from './security'
import { readTheme } from './theme-store'
import { loadWindowState, trackWindowState } from './window-state'

const measureLog = process.env['BRANCHLOG_MEASURE_LOG']
const seenMarks = new Set<string>()

function recordMark(line: string): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('TEMP_MARK ')) return
  if (seenMarks.has(trimmed)) return
  seenMarks.add(trimmed)
  if (!measureLog) return
  try {
    appendFileSync(measureLog, `${trimmed}\n`)
  } catch {
    // The harness still reads the console stream.
  }
}

if (process.env['BRANCHLOG_MEASURE'] === '1') setTempLog(recordMark)
tempMark('main-evaluated', { uptimeMs: Math.round(process.uptime() * 1000) })

let collecting = false

async function collectAndQuit(win: BrowserWindow): Promise<void> {
  if (collecting) return
  collecting = true
  try {
    const dumped: unknown = await win.webContents.executeJavaScript(
      'Array.isArray(globalThis.__tempLines) ? globalThis.__tempLines.join("\\n") : ""',
    )
    if (typeof dumped === 'string') {
      for (const line of dumped.split('\n')) recordMark(line)
    }
  } catch (error) {
    tempMark('collect-failed', { message: error instanceof Error ? error.message : 'failed' })
  }
  tempMark('devtools-opened', {
    open: win.isDestroyed() || !win.webContents.isDevToolsOpened() ? 0 : 1,
  })
  tempMark('window-count', { count: BrowserWindow.getAllWindows().length })
  tempMark('csp-header-checks', { count: contentSecurityHeaderChecks() })
  app.quit()
}

const appRoot = import.meta.dirname
const userDataOverride = process.env.BRANCHLOG_USER_DATA
if (userDataOverride) {
  app.setPath('userData', userDataOverride)
  try {
    mkdirSync(userDataOverride, { recursive: true })
    writeFileSync(path.join(userDataOverride, 'instance.pid'), String(process.pid))
  } catch (error) {
    console.error(error)
  }
}

let mainWindow: BrowserWindow | null = null
let allowQuit = false

function paperColor(): string {
  try {
    return themeBackground(readTheme(), nativeTheme.shouldUseDarkColors)
  } catch (error) {
    console.error(error)
    return themeBackground(defaultTheme(), nativeTheme.shouldUseDarkColors)
  }
}

function createWindow(): BrowserWindow {
  const measuring = process.env['BRANCHLOG_MEASURE'] === '1'
  const stateStart = performance.now()
  const state = loadWindowState()
  tempMark('window-state', { ms: tempMs(stateStart) })
  const constructStart = performance.now()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Branchlog',
    backgroundColor: paperColor(),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(appRoot, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      ...(measuring ? { additionalArguments: ['--branchlog-measure'] } : {}),
    },
  })
  tempMark('window-constructed', { ms: tempMs(constructStart) })
  void win.webContents.setVisualZoomLevelLimits(1, 1).catch((error: unknown) => {
    console.error(error)
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('Preload failed', preloadPath, error)
  })
  win.webContents.on('console-message', (event, _level, message) => {
    const fromEvent = (event as { message?: string }).message
    const text =
      typeof message === 'string' && message.includes('TEMP_MARK')
        ? message
        : typeof fromEvent === 'string'
          ? fromEvent
          : ''
    if (!text.includes('TEMP_MARK')) return
    recordMark(text)
    if (text.includes('"label":"measure-done"')) void collectAndQuit(win)
  })
  win.webContents.on('did-start-loading', () => tempMark('did-start-loading'))
  win.webContents.on('dom-ready', () => tempMark('dom-ready'))
  win.webContents.on('did-finish-load', () => {
    tempMark('did-finish-load')
    void win.webContents.setVisualZoomLevelLimits(1, 1).catch((error: unknown) => {
      console.error(error)
    })
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    if (!(input.control || input.meta) || !input.shift || input.alt) return
    const key = typeof input.key === 'string' ? input.key.toLowerCase() : ''
    if (key !== 't' && input.code !== 'KeyT') return
    event.preventDefault()
    win.webContents.send('menu:action', 'theme-lab')
  })
  if (state.isMaximized) win.maximize()
  trackWindowState(win)
  win.on('ready-to-show', () => {
    tempMark('ready-to-show')
    win.show()
    tempMark('window-shown')
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const fakeNow = testNowSetting()
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (measuring) url.searchParams.set('measure', '1')
    if (fakeNow) url.searchParams.set('branchlogNow', fakeNow)
    void win.loadURL(url.toString())
  } else {
    const query: Record<string, string> = {}
    if (measuring) query.measure = '1'
    if (fakeNow) query.branchlogNow = fakeNow
    void win.loadFile(path.join(appRoot, '../renderer/index.html'), {
      query: Object.keys(query).length > 0 ? query : undefined,
    })
  }
  tempMark('load-called')

  return win
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  app.on('web-contents-created', (_event, contents) => {
    hardenContents(contents)
    installEditContextMenu(contents)
  })

  void app.whenReady().then(() => {
    tempMark('when-ready', {
      uptimeMs: Math.round(process.uptime() * 1000),
      packaged: app.isPackaged ? 1 : 0,
    })
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.branchlog.app')
    }
    const databaseStart = performance.now()
    initDatabase()
    tempMark('init-database-returned', { ms: tempMs(databaseStart) })
    const ipcStart = performance.now()
    installIpc()
    tempMark('install-ipc', { ms: tempMs(ipcStart) })
    const securityStart = performance.now()
    installSecurityPolicy()
    tempMark('install-security', { ms: tempMs(securityStart) })
    const menuStart = performance.now()
    installMenu()
    tempMark('install-menu', { ms: tempMs(menuStart) })
    nativeTheme.on('updated', () => {
      mainWindow?.setBackgroundColor(paperColor())
    })
    mainWindow = createWindow()
    startDailyBackup()
    tempMark('backup-scheduled')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', (event) => {
    if (allowQuit) return
    event.preventDefault()
    allowQuit = true
    void finishBackup().finally(() => {
      closeDatabase()
      app.quit()
    })
  })
}
