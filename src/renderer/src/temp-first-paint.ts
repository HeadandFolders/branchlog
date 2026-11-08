// TEMP first-paint measurement. Removed after the startup report.

import { setTempLog, tempMark, tempMeasuring, tempMs } from '@shared/temp-timing'

const counts: Record<string, number> = {}
let commits = 0
let dimensionEvents = 0
let dimensionNodes = 0
let shellSeen = false
let taskSeen = false
let fontsDone = false
let finished = false

const lines = (globalThis as { __tempLines?: string[] }).__tempLines ?? []
;(globalThis as { __tempLines?: string[] }).__tempLines = lines
setTempLog((line) => {
  lines.push(line)
})

tempMark('js-eval-start')

if (tempMeasuring()) installTempProbes()

export function tempCountRender(name: string): void {
  const host = globalThis as { __blRenders?: Record<string, number> }
  const live = host.__blRenders ?? {}
  live[name] = (live[name] ?? 0) + 1
  host.__blRenders = live
  if (!tempMeasuring()) return
  counts[name] = (counts[name] ?? 0) + 1
}

export function tempNoteCommit(): void {
  commits += 1
  tempMark('react-commit', { n: commits })
}

export function tempNoteFlowDimensions(count: number): void {
  if (!tempMeasuring()) return
  dimensionEvents += 1
  dimensionNodes += count
  tempMark('react-flow-measure', { event: dimensionEvents, nodes: count })
}

function installTempProbes(): void {
  observePaints()
  observeResources()
  observeFonts()
  observeLongTasks()
  watchFrame()
  window.setTimeout(() => finish('timeout'), 20000)
}

function observePaints(): void {
  try {
    const paints = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        tempMark(entry.name === 'first-contentful-paint' ? 'fcp' : entry.name, {
          startTime: round(entry.startTime),
        })
      }
    })
    paints.observe({ type: 'paint', buffered: true })
  } catch {
    tempMark('fcp-unavailable')
  }

  try {
    const lcp = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1] as PerformanceEntry & {
        size?: number
        element?: Element | null
      }
      if (!last) return
      tempMark('lcp', {
        startTime: round(last.startTime),
        size: last.size ?? 0,
        tag: last.element?.tagName ?? '',
        text: (last.element?.textContent ?? '').slice(0, 80),
      })
    })
    lcp.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    tempMark('lcp-unavailable')
  }
}

function observeResources(): void {
  try {
    const resources = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming
        if (!isFontUrl(resource.name)) continue
        tempMark('font-file', {
          name: resource.name,
          startTime: round(resource.startTime),
          duration: round(resource.duration),
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
          initiatorType: resource.initiatorType,
        })
      }
    })
    resources.observe({ type: 'resource', buffered: true })
  } catch {
    tempMark('resource-observer-unavailable')
  }
}

function observeFonts(): void {
  document.fonts.addEventListener('loadingdone', (event) => {
    const done = event as FontFaceSetLoadEvent
    for (const face of done.fontfaces) {
      tempMark('font-loadingdone', {
        family: face.family,
        weight: face.weight,
        status: face.status,
      })
    }
  })
  void document.fonts.ready.then(() => {
    tempMark('fonts-ready', {
      status: document.fonts.status,
      faces: document.fonts.size,
      inter: document.fonts.check('16px Inter') ? 1 : 0,
      newsreader: document.fonts.check('32px Newsreader') ? 1 : 0,
    })
    fontsDone = true
    maybeFinish()
  })
}

function observeLongTasks(): void {
  const onEntries = (list: PerformanceObserverEntryList): void => {
    for (const entry of list.getEntries()) {
      const loaf = entry as PerformanceEntry & {
        scripts?: {
          sourceURL?: string
          functionName?: string
          duration?: number
          invoker?: string
        }[]
      }
      const scripts = (loaf.scripts ?? [])
        .map((script) => {
          const fn = script.functionName || script.invoker || '(anonymous)'
          const url = script.sourceURL ? script.sourceURL.slice(-80) : ''
          return `${fn}@${url}:${Math.round(script.duration ?? 0)}`
        })
        .join(' | ')
      tempMark(entry.entryType === 'long-animation-frame' ? 'loaf' : 'longtask', {
        startTime: round(entry.startTime),
        duration: round(entry.duration),
        scripts: scripts.slice(0, 500),
      })
    }
  }
  try {
    new PerformanceObserver(onEntries).observe({ type: 'longtask', buffered: true })
  } catch {
    tempMark('longtask-unavailable')
  }
  try {
    new PerformanceObserver(onEntries).observe({ type: 'long-animation-frame', buffered: true })
  } catch {
    tempMark('loaf-unavailable')
  }
}

function watchFrame(): void {
  const check = (): void => {
    if (!taskSeen) {
      const title = document.querySelector('h1')
      if (!shellSeen && title instanceof HTMLElement && title.getBoundingClientRect().height > 0) {
        shellSeen = true
        const titleRect = title.getBoundingClientRect()
        tempMark('shell-visible', {
          text: (title.textContent ?? '').slice(0, 80),
          fontFamily: getComputedStyle(title).fontFamily,
          newsreaderReady: document.fonts.check('32px Newsreader') ? 1 : 0,
          left: Math.round(titleRect.left),
          top: Math.round(titleRect.top),
        })
      }
      const task = document.querySelector<HTMLElement>('[data-task-text]')
      if (task && task.getBoundingClientRect().height > 0) {
        taskSeen = true
        const style = getComputedStyle(task)
        const rect = task.getBoundingClientRect()
        tempMark('task-visible', {
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          text: (task.textContent ?? '').slice(0, 80),
          fontFamily: style.fontFamily,
        })
        tempMark('task-ready-for-input', {
          contentEditable: task.contentEditable,
          tabIndex: task.tabIndex,
          pointerEvents: style.pointerEvents,
          visibility: style.visibility,
          display: style.display,
          interReady: document.fonts.check('16px Inter') ? 1 : 0,
        })
        maybeFinish()
        return
      }
    }
    if (!finished) requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

function maybeFinish(): void {
  if (!taskSeen || !fontsDone || finished) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => finish('ready'))
  })
}

function finish(reason: string): void {
  if (finished) return
  finished = true
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (nav) {
    tempMark('navigation', {
      responseEnd: round(nav.responseEnd),
      domInteractive: round(nav.domInteractive),
      domContentLoaded: round(nav.domContentLoadedEventEnd),
      loadEventEnd: round(nav.loadEventEnd),
      transferSize: nav.transferSize,
      decodedBodySize: nav.decodedBodySize,
      type: nav.type,
    })
  }
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  let scripts = 0
  let styles = 0
  let fonts = 0
  let other = 0
  let encoded = 0
  const slowest = [...resources].sort((a, b) => b.duration - a.duration).slice(0, 15)
  for (const resource of resources) {
    encoded += resource.encodedBodySize || 0
    if (isFontUrl(resource.name)) fonts += 1
    else if (resource.initiatorType === 'script') scripts += 1
    else if (resource.initiatorType === 'link' || resource.initiatorType === 'css') styles += 1
    else other += 1
  }
  tempMark('resources', {
    count: resources.length,
    scripts,
    styles,
    fonts,
    other,
    encodedBytes: encoded,
  })
  slowest.forEach((resource, index) => {
    tempMark('resource-slow', {
      rank: index + 1,
      name: resource.name.slice(-140),
      initiatorType: resource.initiatorType,
      duration: round(resource.duration),
      startTime: round(resource.startTime),
      encodedBodySize: resource.encodedBodySize,
    })
  })
  const faces: string[] = []
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const family = rule.style.getPropertyValue('font-family')
      const weight = rule.style.getPropertyValue('font-weight')
      const display = rule.style.getPropertyValue('font-display')
      const src = rule.style.getPropertyValue('src').slice(0, 160)
      faces.push(`${family} ${weight} display=${display} src=${src}`)
    }
  }
  tempMark('font-faces', { count: faces.length, rules: faces.join(' || ').slice(0, 1500) })
  tempMark('render-counts', { ...counts, commits, dimensionEvents, dimensionNodes })
  tempMark('measure-done', { reason, elapsed: tempMs(0) })
}

function isFontUrl(url: string): boolean {
  return url.includes('.woff') || url.includes('.ttf') || url.includes('.otf')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
