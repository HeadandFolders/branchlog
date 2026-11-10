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
        {
          label: 'New task',
          accelerator: 'CmdOrCtrl+N',
          registerAccelerator: false,
          click: () => send('new-task'),
        },
        { type: 'separator' },
        { label: 'Export data', enabled: false },
        { label: 'Import data', enabled: false },
        { type: 'separator' },
        {
          label: 'Settings',
          submenu: [
            {
              label: 'Theme Lab',
              accelerator: 'CmdOrCtrl+Shift+T',
              registerAccelerator: false,
              click: () => send('theme-lab'),
            },
            {
              label: 'AI margin (LM Studio)',
              accelerator: 'CmdOrCtrl+,',
              registerAccelerator: false,
              click: () => send('ai-settings'),
            },
          ],
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
        { label: 'Redo', accelerator: 'Ctrl+Y', visible: false, click: () => send('redo') },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => send('cut') },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => send('select-all') },
      ],
    },
    {
      label: 'Task',
      submenu: [
        {
          label: 'Branch from task',
          accelerator: 'Alt+Enter',
          registerAccelerator: false,
          click: () => send('branch-task'),
        },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Go to Today', accelerator: 'CmdOrCtrl+T', click: () => send('today') },
        { label: 'Previous day', click: () => send('prev-day') },
        { label: 'Next day', click: () => send('next-day') },
        { type: 'separator' },
        {
          label: 'Concept Map',
          accelerator: 'CmdOrCtrl+M',
          registerAccelerator: false,
          click: () => send('show-map'),
        },
        { label: 'Calendar', click: () => send('show-calendar') },
        {
          label: 'Branch from an earlier task',
          accelerator: 'CmdOrCtrl+K',
          registerAccelerator: false,
          click: () => send('earlier-task'),
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
