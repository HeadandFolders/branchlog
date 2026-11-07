import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '@shared/types'

function send(action: MenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:action', action)
}

export function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New task', accelerator: 'CmdOrCtrl+N', click: () => send('new-task') },
        { type: 'separator' },
        { label: 'Export data', enabled: false },
        { label: 'Import data', enabled: false },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', enabled: false },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Go to Today', accelerator: 'CmdOrCtrl+T', click: () => send('today') },
        { label: 'Previous day', click: () => send('prev-day') },
        { label: 'Next day', click: () => send('next-day') },
        { type: 'separator' },
        { label: 'Concept Map', accelerator: 'CmdOrCtrl+M', enabled: false },
        { label: 'Calendar', enabled: false },
        {
          label: 'Branch from an earlier task',
          accelerator: 'CmdOrCtrl+K',
          enabled: false,
        },
      ],
    },
  ]

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    })
  }

  if (!app.isPackaged) {
    template.push({
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }],
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
