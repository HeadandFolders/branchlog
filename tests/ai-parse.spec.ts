import { expect, test } from '@playwright/test'
import { parseCommentJson, parseReplyJson } from '../src/main/ai-parse'

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

test('a reply keeps trimmed text and rejects anything else', () => {
  expect(parseReplyJson({ reply: '  A smaller first step still counts.  ' })).toBe(
    'A smaller first step still counts.',
  )
  expect(parseReplyJson({ reply: null })).toBeNull()
  expect(parseReplyJson({ comment: 'wrong key' })).toBeNull()
  expect(parseReplyJson({ reply: '' })).toBeNull()
  expect(parseReplyJson({ reply: '  ' })).toBeNull()
  expect(parseReplyJson({ reply: 'x'.repeat(2000) })).not.toBeNull()
  expect(parseReplyJson({ reply: 'x'.repeat(2001) })).toBeNull()
  expect(parseReplyJson(null)).toBeNull()
  expect(parseReplyJson(['array'])).toBeNull()
})