import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { localDateKey, msUntilNextLocalMidnight } from '../src/shared/dates'

function keyInZone(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms))
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function delayUntilDateChanges(ms: number, timeZone: string): number {
  const start = keyInZone(ms, timeZone)
  let lo = ms + 1
  let hi = ms + 36 * 60 * 60 * 1000
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (keyInZone(mid, timeZone) === start) lo = mid + 1
    else hi = mid
  }
  return lo - ms
}

function runZone(stamp: number, timeZone: string): { key: string; delay: number } {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'tests', 'date-zone-cli.ts'), String(stamp)],
    {
      cwd: process.cwd(),
      env: { ...process.env, TZ: timeZone },
      encoding: 'utf8',
    },
  )
  expect(result.status, result.stderr || result.stdout).toBe(0)
  const [key, delay] = (result.stdout ?? '').trim().split('\n')
  return { key: key ?? '', delay: Number(delay) }
}

test('today key uses the local calendar date', () => {
  const evening = new Date(2026, 10, 8, 23, 59, 50)
  expect(localDateKey(evening)).toBe('2026-11-08')
  expect(msUntilNextLocalMidnight(evening)).toBe(10_000)
  expect(localDateKey(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01')
  expect(msUntilNextLocalMidnight(new Date(2026, 0, 1, 0, 0, 1))).toBe(86_399_000)
})

test('today key and next midnight follow the time zone', () => {
  const stamp = Date.parse('2026-11-08T12:00:00.000Z')
  const zones = ['Pacific/Auckland', 'Pacific/Honolulu', 'UTC', 'America/New_York']
  for (const zone of zones) {
    const actual = runZone(stamp, zone)
    expect(actual.key).toBe(keyInZone(stamp, zone))
    expect(actual.delay).toBe(delayUntilDateChanges(stamp, zone))
  }
  expect(runZone(stamp, 'Pacific/Auckland').key).toBe('2026-11-09')
  expect(runZone(stamp, 'Pacific/Honolulu').key).toBe('2026-11-08')
  expect(runZone(Date.parse('2026-11-08T06:00:00.000Z'), 'Pacific/Honolulu').key).toBe('2026-11-07')
})

test('next midnight crosses a daylight saving change', () => {
  const spring = Date.parse('2026-03-08T05:30:00.000Z')
  const fall = Date.parse('2026-11-01T04:30:00.000Z')
  const springResult = runZone(spring, 'America/New_York')
  const fallResult = runZone(fall, 'America/New_York')
  expect(springResult.key).toBe('2026-03-08')
  expect(springResult.delay).toBe(22.5 * 60 * 60 * 1000)
  expect(fallResult.key).toBe('2026-11-01')
  expect(fallResult.delay).toBe(24.5 * 60 * 60 * 1000)
})
