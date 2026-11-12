import { expect, test } from '@playwright/test'
import { createAiTrigger, type TriggerTask } from '../src/renderer/src/lib/ai-trigger'
import type { AttributionBrief } from '../src/shared/project-attribution.ts'

interface Scheduled {
  fn: () => void
  at: number
  cancelled: boolean
}

function fakeClock(cap = 3) {
  let now = 0
  let heldSlots = 0
  const jobs: Scheduled[] = []
  const fired: { taskId: string; text: string }[] = []
  const held: string[] = []
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
    hold: (taskId) => {
      if (held.includes(taskId)) return true
      if (heldSlots >= cap) return false
      heldSlots += 1
      held.push(taskId)
      return true
    },
  })
  return {
    trigger,
    fired,
    held,
    releaseHold(taskId: string) {
      const index = held.indexOf(taskId)
      if (index < 0) return
      held.splice(index, 1)
      heldSlots -= 1
    },
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
    projectId: null,
    holdDismissed: false,
    correction: null,
    ...overrides,
  }
}

function brief(name: string, summary: string, overrides: Partial<AttributionBrief> = {}): AttributionBrief {
  return { id: name, name, summary, enabled: true, alwaysInclude: false, ...overrides }
}

// Two briefs a person could actually pick, and neither of them the row says anything about.
const TWO = [brief('inkwell', 'wax seal and nib stock'), brief('foundry', 'casting sand and mold repair')]

const ON = { enabled: true, pauseMs: 2500, remarkOnRequests: false, briefs: [], dayNote: '' }

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
  clock.trigger.textChanged(task({ id: 't5' }), { ...ON, enabled: false })
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

test('a request row waits for a commit unless remarks on requests are on', () => {
  const clock = fakeClock()
  clock.trigger.textChanged(task({ text: '@r draft the vendor email' }), ON)
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(0)
  clock.trigger.textChanged(task({ id: 't2', text: '@r draft the vendor email' }), { ...ON, remarkOnRequests: true })
  clock.advance(2500)
  expect(clock.fired).toEqual([{ taskId: 't2', text: '@r draft the vendor email' }])
})

test('commitRemark needs no pause and the later pause cannot repeat it', () => {
  const clock = fakeClock()
  const options = { ...ON, remarkOnRequests: true }
  const request = task({ text: '@r draft the vendor email' })
  clock.trigger.commitRemark(request, options)
  expect(clock.fired).toEqual([{ taskId: 't1', text: '@r draft the vendor email' }])
  clock.trigger.textChanged(request, options)
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(1)
})

test('a committed remark keeps every ordinary guard', () => {
  const clock = fakeClock()
  const options = { ...ON, remarkOnRequests: true }
  clock.trigger.commitRemark(task({ text: '@r draft it' }), options)
  clock.trigger.commitRemark(task({ id: 't2', text: '@r draft it now', done: true }), options)
  clock.trigger.commitRemark(task({ id: 't3', text: '@r draft it now', side: 'right' }), options)
  clock.trigger.commitRemark(task({ id: 't4', text: '@r draft it now' }), ON)
  clock.trigger.commitRemark(task({ id: 't5', text: '@r draft it now' }), { ...ON, remarkOnRequests: true, enabled: false })
  expect(clock.fired).toHaveLength(0)
})

test('a row two briefs could answer for is asked, not spent', () => {
  const clock = fakeClock()
  const options = { ...ON, briefs: TWO }
  clock.trigger.textChanged(task({ text: 'rewrite the vendor agreement' }), options)
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(0)
  expect(clock.held).toEqual(['t1'])
})

test('one brief whose own word is in the row runs, and the other reading does not hold it', () => {
  const clock = fakeClock()
  const options = { ...ON, briefs: TWO }
  clock.trigger.textChanged(task({ text: 'order more inkwell nibs before friday' }), options)
  clock.advance(2500)
  expect(clock.fired).toEqual([{ taskId: 't1', text: 'order more inkwell nibs before friday' }])
  expect(clock.held).toEqual([])
})

test('a row that names a brief, a day note that names two, a pin and a dismissal all run', () => {
  const clock = fakeClock()
  const options = { ...ON, briefs: TWO }
  const row = { text: 'rewrite the vendor agreement' }
  clock.trigger.textChanged(task({ ...row, projectId: 'foundry' }), options)
  clock.trigger.textChanged(task({ ...row, id: 't2', correction: { projectId: 'inkwell' } }), options)
  clock.trigger.textChanged(task({ ...row, id: 't3', holdDismissed: true }), options)
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(3)
  expect(clock.held).toEqual([])

  const noted = { ...options, dayNote: 'the day is about @inkwell and @foundry' }
  clock.trigger.textChanged(task({ ...row, id: 't4' }), noted)
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(4)
  expect(clock.held).toEqual([])
})

test('what matches is the name and the summary, which is all a brief is here for', () => {
  const clock = fakeClock()
  // An AttributionBrief carries no body, so 'wax seal' — which only inkwell's file says — is out of
  // reach, and the row that holds it matches nothing.
  const briefs = [
    brief('inkwell', 'the desk that signs things'),
    brief('foundry', 'casting sand and mold repair'),
  ]
  const options = { ...ON, briefs }
  clock.trigger.textChanged(task({ text: 'stamp the wax seal on friday' }), options)
  clock.advance(2500)
  expect(clock.fired).toHaveLength(0)
  expect(clock.held).toEqual(['t1'])
})

test('the fourth question a day is refused and leaves its text unspent', () => {
  const clock = fakeClock(3)
  const options = { ...ON, briefs: TWO }
  const texts = ['rewrite the vendor agreement', 'review the insurance paperwork', 'answer the mailbox queue']
  for (const [index, text] of texts.entries()) {
    clock.trigger.textChanged(task({ id: `t${index + 1}`, text }), options)
  }
  clock.advance(10_000)
  expect(clock.held).toEqual(['t1', 't2', 't3'])
  expect(clock.fired).toHaveLength(0)

  clock.trigger.textChanged(task({ id: 't4', text: 'postpone the garden fence painting' }), options)
  clock.advance(10_000)
  expect(clock.held).toHaveLength(3)
  expect(clock.fired).toHaveLength(0)

  // A slot that comes free lets the row that was passed over ask properly, on text it had already typed.
  clock.releaseHold('t1')
  clock.trigger.textChanged(task({ id: 't4', text: 'postpone the garden fence painting again' }), options)
  clock.advance(10_000)
  expect(clock.held).toEqual(['t2', 't3', 't4'])
})

test('the text a pick wrote is spent, so the pause asks only once', () => {
  const clock = fakeClock()
  const options = { ...ON, briefs: TWO }
  const before = 'rewrite the vendor agreement'
  clock.trigger.textChanged(task({ text: before }), options)
  clock.advance(2500)
  expect(clock.fired).toHaveLength(0)
  expect(clock.held).toEqual(['t1'])

  const after = `${before} @inkwell`
  clock.trigger.textChanged(task({ text: after }), options)
  clock.trigger.consume('t1', after)
  clock.advance(10_000)
  expect(clock.fired).toHaveLength(0)
  expect(clock.held).toEqual(['t1'])

  // A later edit is a later question, and it runs because the row now names its brief.
  clock.trigger.textChanged(task({ text: `${after} on friday`, projectId: 'inkwell' }), options)
  clock.advance(2500)
  expect(clock.fired).toEqual([{ taskId: 't1', text: `${after} on friday` }])
})

test('an explicit ask is answered whatever the project turns out to be', () => {
  const clock = fakeClock()
  const options = { ...ON, remarkOnRequests: true, briefs: TWO }
  clock.trigger.commitRemark(task({ text: '@r draft the vendor email' }), options)
  expect(clock.fired).toEqual([{ taskId: 't1', text: '@r draft the vendor email' }])
  expect(clock.held).toEqual([])
})