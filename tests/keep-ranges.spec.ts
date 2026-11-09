import { expect, test } from '@playwright/test'
import {
  clampRanges,
  displaySegments,
  mergeRanges,
  parseRanges,
  rangeFromOffsets,
  removeRange,
  serializeRanges,
} from '../src/renderer/src/lib/keep-ranges'

test('overlapping and adjacent ranges merge into one', () => {
  expect(mergeRanges([[0, 4]], [2, 6])).toEqual([[0, 6]])
  expect(mergeRanges([[0, 3]], [3, 5])).toEqual([[0, 5]])
  expect(mergeRanges([[4, 8]], [0, 2])).toEqual([[0, 2], [4, 8]])
  expect(mergeRanges([[0, 10]], [2, 5])).toEqual([[0, 10]])
  expect(mergeRanges([[6, 9], [0, 3]], [2, 7])).toEqual([[0, 9]])
})

test('removing a range leaves the others in order', () => {
  expect(removeRange([[0, 3], [5, 8], [10, 12]], 1)).toEqual([[0, 3], [10, 12]])
  expect(removeRange([[0, 3]], 0)).toEqual([])
  expect(removeRange([[0, 3]], 4)).toEqual([[0, 3]])
})

test('the display shows kept text with an ellipsis only between non-adjacent ranges', () => {
  const segments = displaySegments('abcdefgh', [[1, 3], [5, 7]])
  expect(segments).toEqual([
    { kind: 'gap', text: 'a', start: 0 },
    { kind: 'kept', text: 'bc', start: 1 },
    { kind: 'gap', text: 'de', start: 3 },
    { kind: 'ellipsis', text: '…', start: 5 },
    { kind: 'kept', text: 'fg', start: 5 },
    { kind: 'gap', text: 'h', start: 7 },
  ])
  expect(displaySegments('abcdef', [[0, 6]])).toEqual([{ kind: 'kept', text: 'abcdef', start: 0 }])
  expect(displaySegments('abcdef', [])).toEqual([{ kind: 'gap', text: 'abcdef', start: 0 }])
})

test('three kept ranges put an ellipsis in each gap', () => {
  const segments = displaySegments('one two three four', [[0, 3], [4, 7], [8, 13]])
  expect(segments.filter((segment) => segment.kind === 'ellipsis')).toHaveLength(2)
  expect(segments.filter((segment) => segment.kind === 'kept').map((segment) => segment.text)).toEqual([
    'one',
    'two',
    'three',
  ])
})

test('parsing is defensive and normalizes', () => {
  expect(parseRanges('[[2,5],[0,2]]')).toEqual([[0, 5]])
  expect(parseRanges('not json')).toEqual([])
  expect(parseRanges('{"a":1}')).toEqual([])
  expect(parseRanges('[[1]]')).toEqual([])
  expect(parseRanges('[[3,1]]')).toEqual([])
  expect(parseRanges('[[-1,2]]')).toEqual([])
  expect(parseRanges('[[0,2.5]]')).toEqual([])
  expect(serializeRanges([[0, 3]])).toBe('[[0,3]]')
})

test('ranges clamp to the text length', () => {
  expect(clampRanges([[0, 99]], 5)).toEqual([[0, 5]])
  expect(clampRanges([[7, 9]], 5)).toEqual([])
  expect(clampRanges([[-2, 3]], 5)).toEqual([[0, 3]])
})

test('selection offsets span inline pieces, emoji, and non-English text', () => {
  const pieces = [
    { start: 0, length: 4 },
    { start: 4, length: 2 },
    { start: 6, length: 5 },
  ]
  expect(rangeFromOffsets(pieces, 0, 2, 2, 3)).toEqual([2, 9])
  expect(rangeFromOffsets(pieces, 2, 3, 0, 2)).toEqual([2, 9])
  expect(rangeFromOffsets(pieces, 1, 0, 1, 2)).toEqual([4, 6])
  expect(rangeFromOffsets(pieces, 1, 1, 1, 1)).toBeNull()
  expect(rangeFromOffsets(pieces, 9, 0, 0, 1)).toBeNull()
  expect(rangeFromOffsets(pieces, 0, 99, 1, 0)).toBeNull()
})

test('emoji offsets count UTF-16 units the same way the DOM does', () => {
  const text = 'Ship 🚀 now'
  const rocket = text.indexOf('🚀')
  expect(rocket).toBe(5)
  const pieces = [
    { start: 0, length: rocket },
    { start: rocket, length: 2 },
    { start: rocket + 2, length: text.length - rocket - 2 },
  ]
  const range = rangeFromOffsets(pieces, 0, 2, 2, 3)
  expect(range).toEqual([2, rocket + 5])
  expect(text.slice(range![0], range![1])).toBe('ip 🚀 no')
  const arabic = 'مرحبا بالعالم'
  expect(rangeFromOffsets([{ start: 0, length: arabic.length }], 0, 0, 0, 5)).toEqual([0, 5])
  expect(arabic.slice(0, 5)).toBe('مرحبا')
})