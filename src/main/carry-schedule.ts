import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, powerMonitor } from 'electron'
import { localDateKey, msUntilNextLocalMidnight } from '@shared/dates'
import { tempMark } from '@shared/temp-timing'
import type { CarryRun } from '@shared/types'
import { CARRY_PAINT_BUDGET_MS, carryForward, countCarryInput, type CarryResult } from './carry'
import { getDatabase } from './database'

// About 400 unfinished rows stayed under the 20ms first-paint budget.
const INLINE_TASK_LIMIT = 400

let armed = false
let didStartup = false
let rerun = false
let buffered: CarryRun[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let watching = ''

function toRun(result: CarryResult): CarryRun {
  return { id: randomUUID(), date: result.date, tasks: result.tasks }
}

function execute(reason: string): CarryRun | null {
  const result = carryForward(getDatabase())
  const ms = Math.round(result.ms * 10) / 10
  tempMark('carry', { reason, ms, created: result.tasks.length })
  if (result.ms > CARRY_PAINT_BUDGET_MS) tempMark('carry-budget', { reason, ms, over: 1 })
  if (result.tasks.length === 0) return null
  return toRun(result)
}

function broadcast(run: CarryRun): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('carry:applied', run)
  }
}

function publish(reason: string): void {
  const run = execute(reason)
  if (!run) return
  if (!armed) buffered.push(run)
  else broadcast(run)
}

function prime(): void {
  const count = countCarryInput(getDatabase())
  if (count === 0) {
    didStartup = true
    return
  }
  if (count > INLINE_TASK_LIMIT) return
  const run = execute('startup')
  didStartup = true
  if (run) buffered.push(run)
}

function armMidnight(): void {
  if (timer) clearTimeout(timer)
  watching = localDateKey()
  const delay = Math.max(msUntilNextLocalMidnight(), 50)
  timer = setTimeout(() => {
    timer = null
    const today = localDateKey()
    if (today === watching) {
      armMidnight()
      return
    }
    if (!armed) rerun = true
    else publish('midnight')
    armMidnight()
  }, delay)
}

export function carryOnDemand(): void {
  if (!armed) {
    rerun = true
    return
  }
  publish('setting')
}

export function installCarrySchedule(): void {
  prime()
  armMidnight()
  app.on('browser-window-focus', () => {
    if (!armed) {
      rerun = true
      return
    }
    publish('focus')
  })
  powerMonitor.on('resume', () => {
    if (!armed) rerun = true
    else publish('resume')
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('clock:resume')
    }
  })
}

export function takeStartupCarry(): CarryRun[] {
  const runs = buffered.splice(0, buffered.length)
  if (!didStartup) {
    didStartup = true
    const run = execute('after-paint')
    if (run) runs.push(run)
  }
  if (rerun) {
    rerun = false
    const run = execute('followup')
    if (run) runs.push(run)
  }
  armed = true
  return runs
}

export function stopCarrySchedule(): void {
  if (!timer) return
  clearTimeout(timer)
  timer = null
}
