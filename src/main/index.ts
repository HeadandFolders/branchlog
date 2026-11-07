import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { finishBackup, startDailyBackup } from './backup'
import { closeDatabase, initDatabase } from './database'
import { installIpc } from './ipc'
import { installMenu } from './menu'
import { installEditContextMenu } from './context-menu'
import { hardenContents, installSecurityPolicy } from './security'
import { loadWindowState, trackWindowState } from './window-state'

const appRoot = import.meta.dirname
const userDataOverride = process.env.BRANCHLOG_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)

let mainWindow: BrowserWindow | null = null
let allowQuit = false

function paperColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#161614' : '#F3F3EF'
}

function createWindow(): BrowserWindow {
  const state = loadWindowState()
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
    },
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('Preload failed', preloadPath, error)
  })
  if (state.isMaximized) win.maximize()
  trackWindowState(win)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(appRoot, '../renderer/index.html'))
  }

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
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.branchlog.app')
    }
    initDatabase()
    installIpc()
    installSecurityPolicy()
    installMenu()
    nativeTheme.on('updated', () => {
      mainWindow?.setBackgroundColor(paperColor())
    })
    mainWindow = createWindow()
    startDailyBackup()
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
