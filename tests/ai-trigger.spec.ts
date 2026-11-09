import { expect, test } from '@playwright/test'
import { createAiTrigger, type TriggerTask } from '../src/renderer/src/lib/ai-trigger'

interface Scheduled {
  fn: () => void
  at: number
  cancelled: boolean
}

function fakeClock() {
  let now = 0
  const jobs: Scheduled[] = []
  const fired: { taskId: string; text: string }[] = []
  const trigger = createAiTrigger({
    schedule: (fn, ms) => {
      jobs.push({ fn, at: now + ms, cancelled: false })
      return jobs.length - 1
    },
    cancel: (handle) => {
      const job = jobs[handle]
      if (job) job.cancelled = true
    },
    fire: (taskId, text) => fired.push({ taskId, text }),
  })
  return {
    trigger,
    fired,
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = jobs
          .filter((job) => !job.cancelled && job.at <= target)
          .sort((a, b) => a.at - b.at)[0]
        if (!due) break
        now = due.at
        due.cancelled = true
        due.fn()
      }
      now = target
    },
  }
}

function task(overrides: Partial<TriggerTask> = {}): TriggerTask {
  return {
    id: 't1',
    text: 'ship the quarterly report',
    side: 'main',
    done: false,
    droppedAt: null,
    ...overrides,
  }
}

const ON = { enabled: true, pauseMs: 2500 }

test('fires once after the pause, not on every keystroke', () => {
  const clock = fakeClock()
  clock.trigger.textChanged(task({ text: 'ship the q' }), ON)
  clock.advance(1000)
  clock.trigger.textChanged(task({ text: 'ship the quarterly report' }), ON)
  clock.advance(2499)
  expect(clock.fired).toHaveLength(0)
  clock.advance(1)
  expect(clock.fired).toEqual([{ taskId: 't1', text: 'ship the quarterly report' }])
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(1)
})

test('short text, done, dropped, right-side, and disabled never fire', () => {
  const clock = fakeClock()
  clock.trigger.textChanged(task({ text: 'too short' }), ON)
  clock.trigger.textChanged(task({ id: 't2', done: true }), ON)
  clock.trigger.textChanged(task({ id: 't3', droppedAt: '2026-11-08' }), ON)
  clock.trigger.textChanged(task({ id: 't4', side: 'right' }), ON)
  clock.trigger.textChanged(task({ id: 't5' }), { enabled: false, pauseMs: 2500 })
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(0)
})

test('the twelve-character minimum counts trimmed text', () => {
  const clock = fakeClock()
  clock.trigger.textChanged(task({ text: '  ten chars ' }), ON)
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(0)
  clock.trigger.textChanged(task({ text: 'twelve chars!' }), ON)
  clock.advance(2500)
  expect(clock.fired).toHaveLength(1)
})

test('the same text is never sent twice for one task', () => {
  const clock = fakeClock()
  const first = 'write the launch notes'
  const second = 'rewrite the launch notes'
  clock.trigger.textChanged(task({ text: first }), ON)
  clock.advance(2500)
  clock.trigger.textChanged(task({ text: second }), ON)
  clock.advance(2500)
  clock.trigger.textChanged(task({ text: first }), ON)
  clock.advance(10_000)
  expect(clock.fired.map((entry) => entry.text)).toEqual([first, second])
})

test('editing again during the pause restarts the delay with the newest text', () => {
  const clock = fakeClock()
  clock.trigger.textChanged(task({ text: 'draft one of the plan' }), ON)
  clock.advance(2000)
  clock.trigger.textChanged(task({ text: 'draft two of the plan' }), ON)
  clock.advance(2000)
  expect(clock.fired).toHaveLength(0)
  clock.advance(500)
  expect(clock.fired).toEqual([{ taskId: 't1', text: 'draft two of the plan' }])
})

test('cancel stops a pending check and reset also forgets sent text', () => {
  const clock = fakeClock()
  clock.trigger.textChanged(task(), ON)
  clock.trigger.cancel('t1')
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(0)
  clock.trigger.textChanged(task(), ON)
  clock.advance(2500)
  expect(clock.fired).toHaveLength(1)
  clock.trigger.reset()
  clock.trigger.textChanged(task(), ON)
  clock.advance(2500)
  expect(clock.fired).toHaveLength(2)
})