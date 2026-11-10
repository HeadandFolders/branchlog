export const shortcutMod = /Mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'

export interface ShortcutRow {
  label: string
  keys: string
}

export interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

export const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'write',
    rows: [
      { label: 'New task', keys: `${shortcutMod}+N` },
      { label: 'Task below', keys: 'Enter' },
      { label: 'Line inside a task', keys: 'Shift+Enter' },
      { label: 'Branch from task', keys: 'Alt+Enter' },
      { label: 'Up / down the list', keys: '↑  ↓' },
      { label: 'Let it go', keys: 'hover the row' },
      { label: 'Delete an empty task', keys: 'Backspace' },
      { label: 'Leave the field', keys: 'Esc' },
    ],
  },
  {
    title: 'panels',
    rows: [
      { label: 'AI margin (LM Studio)', keys: `${shortcutMod}+,` },
      { label: 'Theme Lab', keys: `${shortcutMod}+Shift+T` },
      { label: 'Close a panel', keys: 'Esc' },
    ],
  },
  {
    title: 'paper',
    rows: [
      { label: 'Paste an image', keys: `${shortcutMod}+V` },
      { label: 'Drop an image file', keys: 'drag it in' },
      { label: 'Crop an image', keys: 'edge handles' },
      { label: 'Delete an image', keys: 'Backspace' },
      { label: 'Pan', keys: 'swipe, or drag' },
      { label: 'Zoom', keys: `pinch, or ${shortcutMod}+scroll` },
    ],
  },
]
