import { expect, test } from '@playwright/test'
import { classifyProse, parseCommentJson, parseReplyJson, truncateToCharBudget } from '../src/main/ai-parse'

test('a well-formed comment keeps its text and type', () => {
  expect(parseCommentJson({ comment: '  What does done look like?  ', type: 'question' })).toEqual({
    text: 'What does done look like?',
    type: 'question',
  })
  expect(parseCommentJson({ comment: 'Two dates disagree.', type: 'correction' })?.type).toBe('correction')
})

test('a null comment, missing fields, and non-objects parse to nothing', () => {
  expect(parseCommentJson({ comment: null, type: 'remark' })).toBeNull()
  expect(parseCommentJson({ type: 'question' })).toBeNull()
  expect(parseCommentJson({ comment: 42 })).toBeNull()
  expect(parseCommentJson(null)).toBeNull()
  expect(parseCommentJson('a plain string')).toBeNull()
  expect(parseCommentJson([{ comment: 'inside an array' }])).toBeNull()
})

test('empty, whitespace-only, and oversized comments are rejected', () => {
  expect(parseCommentJson({ comment: '' })).toBeNull()
  expect(parseCommentJson({ comment: '   \n ' })).toBeNull()
  expect(parseCommentJson({ comment: 'x'.repeat(500) })).not.toBeNull()
  expect(parseCommentJson({ comment: 'x'.repeat(501) })).toBeNull()
})

test('an unknown or missing type falls back to remark', () => {
  expect(parseCommentJson({ comment: 'An observation.' })?.type).toBe('remark')
  expect(parseCommentJson({ comment: 'An observation.', type: 'pep-talk' })?.type).toBe('remark')
  expect(parseCommentJson({ comment: 'An observation.', type: 7 })?.type).toBe('remark')
})

test('a reply keeps trimmed text, and a long one is cut rather than thrown away', () => {
  expect(parseReplyJson({ reply: '  A smaller first step still counts.  ' })).toBe(
    'A smaller first step still counts.',
  )
  expect(parseReplyJson({ reply: null })).toBeNull()
  expect(parseReplyJson({ comment: 'wrong key' })).toBeNull()
  expect(parseReplyJson({ reply: '' })).toBeNull()
  expect(parseReplyJson({ reply: '  ' })).toBeNull()
  expect(parseReplyJson({ reply: 'x'.repeat(2000) })).toBe('x'.repeat(2000))
  expect(parseReplyJson(null)).toBeNull()
  expect(parseReplyJson(['array'])).toBeNull()
  const long = parseReplyJson({ reply: 'Word. '.repeat(400) })
  expect(long).toMatch(/\[truncated\]$/)
  expect(long?.length).toBeLessThanOrEqual(2_000)
})

test('truncation lands on the last full sentence inside the budget', () => {
  expect(truncateToCharBudget('Alpha. Beta. Gamma.', 30)).toBe('Alpha. Beta. Gamma.')
  expect(truncateToCharBudget('Alpha. Beta. Gamma.', 18)).toBe('Alpha. [truncated]')
  expect(truncateToCharBudget('First line.\nSecond line.', 23)).toBe('First line. [truncated]')
  expect(truncateToCharBudget('He said "No." Then left immediately.', 25)).toBe('He said "No." [truncated]')
})

test('with no sentence to land on it hard-cuts, and the result never passes the cap', () => {
  const cut = truncateToCharBudget('A'.repeat(100), 20)
  expect(cut).toBe(`${'A'.repeat(8)} [truncated]`)
  expect(cut.length).toBeLessThanOrEqual(20)
})

test('prose that opens with QUESTION: is a question, with the prefix stripped', () => {
  expect(classifyProse('  question:  Which day looks right?  ')).toEqual({
    kind: 'question',
    text: 'Which day looks right?',
  })
  expect(classifyProse('QUESTION:Which day?')).toEqual({ kind: 'question', text: 'Which day?' })
  expect(classifyProse('Here is the plan.')).toEqual({ kind: 'deliverable', text: 'Here is the plan.' })
  expect(classifyProse('My question: which day?')).toEqual({ kind: 'deliverable', text: 'My question: which day?' })
  expect(classifyProse('question:')).toEqual({ kind: 'question', text: '' })
})