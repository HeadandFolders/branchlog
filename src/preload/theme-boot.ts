import { ipcRenderer } from 'electron'
import { defaultTheme, parseThemeDocument, themeRuntimeCss, type ThemeDocument } from '@shared/theme'

function readTheme(): ThemeDocument {
  try {
    return parseThemeDocument(ipcRenderer.sendSync('settings:theme'))
  } catch (error) {
    console.error(error)
    return defaultTheme()
  }
}

function mount(css: string, theme: ThemeDocument): void {
  const root = document.documentElement
  if (!root) return
  if (!theme.followSystem) root.dataset.theme = theme.mode
  let style = document.getElementById('branchlog-theme')
  if (!style) {
    style = document.createElement('style')
    style.id = 'branchlog-theme'
    ;(document.head ?? root).prepend(style)
  }
  style.textContent = css
  requestAnimationFrame(() => {
    root.setAttribute('data-first-bg', getComputedStyle(root).backgroundColor)
  })
}

export function bootTheme(): void {
  const theme = readTheme()
  const css = themeRuntimeCss(theme)
  const apply = (): void => mount(css, theme)
  if (document.documentElement) apply()
  else {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return
      observer.disconnect()
      apply()
    })
    observer.observe(document, { childList: true, subtree: true })
  }
}
