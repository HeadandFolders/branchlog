import {
  BrowserWindow,
  Menu,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron'

export function editContextLabels(suggestions: string[]): string[] {
  return [...suggestions, 'Cut', 'Copy', 'Paste', 'Select All']
}

function template(contents: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = params.dictionarySuggestions.map((suggestion) => ({
    label: suggestion,
    click: () => contents.replaceMisspelling(suggestion),
  }))
  if (items.length > 0) items.push({ type: 'separator' })
  const editable = params.isEditable
  const selected = params.selectionText.length > 0
  items.push(
    {
      label: 'Cut',
      enabled: params.editFlags.canCut || selected,
      click: () => {
        if (editable) contents.cut()
        else contents.send('menu:action', 'cut')
      },
    },
    {
      label: 'Copy',
      enabled: params.editFlags.canCopy || selected,
      click: () => {
        if (editable) contents.copy()
        else contents.send('menu:action', 'copy')
      },
    },
    {
      label: 'Paste',
      enabled: params.editFlags.canPaste || editable,
      click: () => contents.paste(),
    },
    {
      label: 'Select All',
      enabled: params.editFlags.canSelectAll || editable || selected,
      click: () => contents.send('menu:action', 'select-all'),
    },
  )
  return items
}

export function installEditContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    if (!params.isEditable && params.selectionText.length === 0 && params.misspelledWord.length === 0) return
    const menu = Menu.buildFromTemplate(template(contents, params))
    const win = BrowserWindow.fromWebContents(contents)
    menu.popup(win ? { window: win } : {})
  })
}

if (process.env.BRANCHLOG_USER_DATA) {
  Object.assign(globalThis, { __branchlogEditLabels: editContextLabels })
}
