import { session, type WebContents } from 'electron'

function contentSecurityPolicy(): string {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
  if (isDev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*",
    ].join('; ')
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: branchlog-image:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ')
}

let headerChecks = 0

export function contentSecurityHeaderChecks(): number {
  return headerChecks
}

export function installSecurityPolicy(): void {
  const policy = contentSecurityPolicy()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    headerChecks += 1
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

export function hardenContents(contents: WebContents): void {
  contents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  contents.on('will-redirect', (event) => {
    event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}
