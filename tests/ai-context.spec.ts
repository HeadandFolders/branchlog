import { expect, test } from '@playwright/test'
import type { AiComment, AiReply } from '../src/shared/ai-comments'
import type { Task } from '../src/shared/types'
import {
  buildCommentMessages,
  buildReplyMessages,
  MAX_ANCESTORS,
  MAX_DAY_CHARS,
  MAX_DAY_TASKS,
} from '../src/main/ai-prompts'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    text: 'ship the quarterly report',
    done: false,
    dateCreated: '2026-11-08',
    dateCompleted: null,
    parentId: null,
    x: 0,
    y: 0,
    width: 320,
    height: 28,
    side: 'main',
    orderIndex: 0,
    carriedFromId: null,
    chainId: 't1',
    droppedAt: null,
    ...overrides,
  }
}

function comment(replies: AiReply[]): AiComment {
  return {
    id: 'c1',
    taskId: 't1',
    side: 'left',
    type: 'question',
    text: 'What does done look like for this?',
    status: 'open',
    keptRanges: '[]',
    x: -280,
    y: 0,
    createdAt: '2026-11-08T10:00:00.000Z',
    replies,
  }
}

function reply(index: number, role: 'user' | 'ai'): AiReply {
  return {
    id: `r${index}`,
    commentId: 'c1',
    role,
    text: `reply number ${index}`,
    keptRanges: '[]',
    createdAt: '2026-11-08T10:01:00.000Z',
  }
}

test('the lineage is sent oldest-first and capped at five ancestors', () => {
  const ancestors = Array.from({ length: 8 }, (_, index) =>
    task({ id: `a${index}`, text: `ancestor ${index}` }),
  )
  const current = task({ text: 'the current task' })
  const messages = buildCommentMessages(current, ancestors, [])
  expect(messages).toHaveLength(2)
  expect(messages[0].role).toBe('system')
  const body = messages[1].content
  expect(body).not.toContain('ancestor 5')
  expect(body).not.toContain('ancestor 6')
  expect(body).not.toContain('ancestor 7')
  const lines = body.split('\n')
  expect(lines.slice(0, MAX_ANCESTORS)).toEqual(
    ancestors.slice(0, MAX_ANCESTORS).reverse().map((item, index) => `Earlier line ${index + 1}: ${item.text}`),
  )
  expect(lines[MAX_ANCESTORS]).toBe('Current task: the current task')
})

test('the day list skips the current task and right-side branches', () => {
  const current = task()
  const day = [
    task({ id: 't2', text: 'another main task' }),
    task({ id: 't3', text: 'a branch', side: 'right' }),
    current,
    task({ id: 't4', text: 'a finished one', done: true }),
  ]
  const body = buildCommentMessages(current, [], day)[1].content
  expect(body).toContain('- another main task')
  expect(body).toContain('- (done) a finished one')
  expect(body).not.toContain('a branch')
  expect(body.match(/ship the quarterly report/g)).toHaveLength(1)
})

test('the day list stops at thirty tasks', () => {
  const day = Array.from({ length: 60 }, (_, index) =>
    task({ id: `d${index}`, text: `day task ${index}` }),
  )
  const body = buildCommentMessages(task(), [], day)[1].content
  const lines = body.split('\n').filter((line) => line.startsWith('- '))
  expect(lines).toHaveLength(MAX_DAY_TASKS)
  expect(body).toContain('- day task 0')
  expect(body).toContain(`- day task ${MAX_DAY_TASKS - 1}`)
  expect(body).not.toContain(`- day task ${MAX_DAY_TASKS}`)
})

test('the day list stops before the two-thousand-character budget', () => {
  const day = Array.from({ length: 20 }, (_, index) =>
    task({ id: `d${index}`, text: `task ${index} ${'x'.repeat(300)}` }),
  )
  const body = buildCommentMessages(task(), [], day)[1].content
  const lines = body.split('\n').filter((line) => line.startsWith('- '))
  const total = lines.reduce((sum, line) => sum + line.length, 0)
  expect(total).toBeLessThanOrEqual(MAX_DAY_CHARS)
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.length).toBeLessThan(20)
})

test('with no day tasks the prompt has only the lineage', () => {
  const body = buildCommentMessages(task(), [], [task()])[1].content
  expect(body).toBe('Current task: ship the quarterly report')
  expect(body).not.toContain('Other tasks today')
})

test('a reply keeps the task, the earlier comment, and the last ten replies', () => {
  const replies = Array.from({ length: 14 }, (_, index) => reply(index, index % 2 === 0 ? 'user' : 'ai'))
  const messages = buildReplyMessages(task(), comment(replies), 'my newest answer')
  expect(messages).toHaveLength(2)
  expect(messages[0].role).toBe('system')
  const lines = messages[1].content.split('\n')
  expect(lines[0]).toBe('Task: ship the quarterly report')
  expect(lines[1]).toBe('Your earlier comment: What does done look like for this?')
  expect(lines.slice(2, -1)).toHaveLength(10)
  expect(lines[2]).toBe('Person: reply number 4')
  expect(lines[3]).toBe('You: reply number 5')
  expect(lines.at(-1)).toBe('Person: my newest answer')
  expect(messages[1].content).not.toContain('reply number 3')
})

test('a first reply has no history lines', () => {
  const body = buildReplyMessages(task(), comment([]), 'a first answer')[1].content
  expect(body.split('\n')).toHaveLength(3)
  expect(body.endsWith('Person: a first answer')).toBe(true)
})