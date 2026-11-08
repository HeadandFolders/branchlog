function readTestNowRaw(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  const fromEnv = proc?.env?.BRANCHLOG_NOW
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  const search = (globalThis as { location?: { search?: string } }).location?.search
  if (!search) return undefined
  const fromQuery = new URLSearchParams(search).get('branchlogNow')
  return fromQuery && fromQuery.length > 0 ? fromQuery : undefined
}

let clockAnchor: { raw: string; mark: number; fake: number } | null = null

function fakeInstant(raw: string, realNow: number): number | null {
  const beforeMidnight = /^before-midnight:(\d+(?:\.\d+)?)$/.exec(raw)
  if (beforeMidnight) {
    const seconds = Number(beforeMidnight[1])
    if (!Number.isFinite(seconds) || seconds < 0) return null
    const real = new Date(realNow)
    const midnight = new Date(real.getFullYear(), real.getMonth(), real.getDate() + 1, 0, 0, 0, 0)
    return midnight.getTime() - seconds * 1000
  }
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

export function now(): Date {
  const raw = readTestNowRaw()
  if (!raw) return new Date()
  if (!clockAnchor || clockAnchor.raw !== raw) {
    const realNow = Date.now()
    const fake = fakeInstant(raw, realNow)
    if (fake === null) return new Date()
    clockAnchor = { raw, mark: realNow, fake }
  }
  return new Date(clockAnchor.fake + (Date.now() - clockAnchor.mark))
}

export function testNowSetting(): string | undefined {
  return readTestNowRaw()
}
