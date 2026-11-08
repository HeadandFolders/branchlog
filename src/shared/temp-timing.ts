// TEMP first-paint measurement. Removed after the startup report.

type TempValue = string | number | boolean | null

let sink: ((line: string) => void) | null = null
let measuring: boolean | null = null

export function setTempLog(fn: (line: string) => void): void {
  sink = fn
}

export function tempMeasuring(): boolean {
  if (measuring !== null) return measuring
  measuring = detectMeasuring()
  return measuring
}

function detectMeasuring(): boolean {
  try {
    const loc = (globalThis as { location?: { search?: string } }).location
    if (loc?.search?.includes('measure=1')) return true
  } catch {
    // location is absent in the main process
  }
  try {
    const proc = (globalThis as { process?: { argv?: string[]; env?: Record<string, string | undefined> } })
      .process
    if (proc?.argv?.includes('--branchlog-measure')) return true
    if (proc?.env?.['BRANCHLOG_MEASURE'] === '1') return true
  } catch {
    // process is absent in the sandboxed page
  }
  return false
}

export function tempMs(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100
}

export function tempMark(label: string, extra?: Record<string, TempValue>): void {
  if (!tempMeasuring()) return
  let perf = 0
  let origin = 0
  try {
    perf = performance.now()
    origin = performance.timeOrigin
    performance.mark(`TEMP ${label}`)
  } catch {
    // performance.mark is unavailable in this context
  }
  const line = `TEMP_MARK ${JSON.stringify({
    label,
    now: Date.now(),
    perf: Math.round(perf * 100) / 100,
    origin,
    ...extra,
  })}`
  sink?.(line)
  console.log(line)
}
