import { expect, test } from '@playwright/test'
import { SEPARATE_GAP, separateBodies, separateNearby, type SeparateBody } from '../src/shared/separate'

function box(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 40,
  extra: Partial<SeparateBody> = {},
): SeparateBody {
  return {
    id,
    x,
    y,
    width,
    height,
    fixed: false,
    pinned: false,
    parentId: null,
    ...extra,
  }
}

function placed(bodies: SeparateBody[], moves: { id: string; x: number; y: number }[]): Map<string, SeparateBody> {
  const next = new Map(bodies.map((body) => [body.id, { ...body }]))
  for (const move of moves) {
    const body = next.get(move.id)
    if (!body) continue
    body.x = move.x
    body.y = move.y
  }
  return next
}

function gap(a: SeparateBody, b: SeparateBody): number {
  const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width))
  const gapY = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  return Math.max(gapX, gapY)
}

function expectClear(bodies: SeparateBody[], moves: { id: string; x: number; y: number }[]): Map<string, SeparateBody> {
  const next = placed(bodies, moves)
  const list = [...next.values()].filter((body) => !body.fixed)
  for (let i = 0; i < list.length; i += 1) {
    const left = list[i]
    if (!left) continue
    for (let j = i + 1; j < list.length; j += 1) {
      const right = list[j]
      if (!right) continue
      expect(gap(left, right)).toBeGreaterThanOrEqual(SEPARATE_GAP)
    }
  }
  for (const fixed of next.values()) {
    if (!fixed.fixed) continue
    for (const body of list) {
      expect(gap(fixed, body)).toBeGreaterThanOrEqual(SEPARATE_GAP)
    }
  }
  return next
}

test('overlapping rectangles separate by the gap and leave the resting one', () => {
  const bodies = [box('a', 0, 0), box('b', 0, 0)]
  const moves = separateBodies(bodies, 'a')
  expect(moves.map((move) => move.id)).toEqual(['a'])
  const next = expectClear(bodies, moves)
  expect(next.get('b')).toMatchObject({ x: 0, y: 0 })
  expect(next.get('a')?.y).toBeGreaterThan(0)
})

test('a pinned node stays where it was dropped', () => {
  const bodies = [box('drag', 0, 0, 100, 40, { pinned: true }), box('other', 10, 8)]
  const moves = separateBodies(bodies, 'drag')
  expect(moves.some((move) => move.id === 'drag')).toBe(false)
  const next = expectClear(bodies, moves)
  expect(next.get('drag')).toMatchObject({ x: 0, y: 0 })
  expect(moves.some((move) => move.id === 'other')).toBe(true)
})

test('a fixed anchor never moves', () => {
  const bodies = [box('list', 0, 0, 200, 48, { fixed: true }), box('branch', 40, 8)]
  const moves = separateBodies(bodies, 'branch')
  expect(moves.map((move) => move.id)).toEqual(['branch'])
  const next = expectClear(bodies, moves)
  expect(next.get('list')).toMatchObject({ x: 0, y: 0 })
  expect(next.get('branch')).toMatchObject({ x: 40 })
})

test('a node far from the collision stays put', () => {
  const bodies = [box('a', 0, 0), box('b', 0, 0), box('far', 2400, 10)]
  const moves = separateNearby(bodies, 'a')
  expect(moves.some((move) => move.id === 'far')).toBe(false)
  expectClear(bodies, moves)
})

test('a branch is not pushed left of its parent', () => {
  const bodies = [
    box('parent', 0, 0, 180, 40, { fixed: true }),
    box('child', 20, 0, 100, 40, { parentId: 'parent' }),
  ]
  const moves = separateBodies(bodies, 'child')
  const next = expectClear(bodies, moves)
  expect(next.get('child')?.x).toBeGreaterThanOrEqual(180 + SEPARATE_GAP)
})

test('a node inside the main list column steps out instead of walking down it', () => {
  const rows: SeparateBody[] = []
  for (let index = 0; index < 30; index += 1) {
    rows.push(box(`row${index}`, 0, 64 + index * 38, 560, 38, { fixed: true }))
  }
  const bodies = [...rows, box('child', 120, 147, 240, 42, { parentId: 'row2' })]
  const moves = separateNearby(bodies, 'child')
  const next = expectClear(bodies, moves)
  const child = next.get('child')
  if (!child) throw new Error('child is missing')
  expect(child.x).toBeGreaterThanOrEqual(560 + SEPARATE_GAP)
  expect(Math.abs(child.y - 147)).toBeLessThan(80)
})

test('a node with no parent steps out of the main list column too', () => {
  const rows: SeparateBody[] = []
  for (let index = 0; index < 30; index += 1) {
    rows.push(box(`row${index}`, 0, 64 + index * 38, 560, 38, { fixed: true }))
  }
  const bodies = [...rows, box('picture', 300, 147, 240, 42)]
  const moves = separateNearby(bodies, 'picture')
  const next = expectClear(bodies, moves)
  const picture = next.get('picture')
  if (!picture) throw new Error('picture is missing')
  expect(picture.x).toBeGreaterThanOrEqual(560 + SEPARATE_GAP)
  expect(Math.abs(picture.y - 147)).toBeLessThan(80)
})

test('coincident nodes clear by moving only the new one', () => {
  const bodies = [box('a', 30, 12), box('b', 30, 12), box('c', 30, 12), box('d', 30, 12)]
  const moves = separateBodies(bodies, 'd')
  expect(moves.map((move) => move.id)).toEqual(['d'])
  const next = placed(bodies, moves)
  for (const id of ['a', 'b', 'c']) {
    expect(next.get(id)).toMatchObject({ x: 30, y: 12 })
    const other = next.get(id)
    const moved = next.get('d')
    if (!other || !moved) throw new Error('missing')
    expect(gap(other, moved)).toBeGreaterThanOrEqual(SEPARATE_GAP)
  }
})

test('several new nodes at one spot end clear and to the right of the parent', () => {
  let bodies = [box('parent', 0, 0, 200, 40, { fixed: true })]
  for (const id of ['a', 'b', 'c', 'd']) {
    bodies.push(box(id, 220, 0, 100, 44, { parentId: 'parent' }))
    const moves = separateBodies(bodies, id)
    bodies = [...placed(bodies, moves).values()]
  }
  const branches = bodies.filter((body) => body.id !== 'parent')
  expect(branches.map((body) => body.x)).toEqual([220, 220, 220, 220])
  for (const body of branches) expect(body.x).toBeGreaterThanOrEqual(200 + SEPARATE_GAP)
  expectClear(bodies, [])
})

test('nothing happens when the rectangles already have a gap', () => {
  const bodies = [box('a', 0, 0), box('b', 0, 40 + SEPARATE_GAP)]
  expect(separateBodies(bodies, 'a')).toEqual([])
  expect(separateNearby(bodies, 'a')).toEqual([])
})

test('the same rectangles always settle in the same place', () => {
  const bodies = [
    box('parent', 0, 0, 160, 36, { fixed: true }),
    box('a', 150, 0, 120, 50, { parentId: 'parent' }),
    box('b', 170, 20, 120, 50, { parentId: 'parent' }),
    box('c', 160, 8, 90, 70, { parentId: 'parent', pinned: true }),
  ]
  const once = separateBodies(bodies, 'c')
  const twice = separateBodies(bodies, 'c')
  expect(twice).toEqual(once)
  const next = placed(bodies, once)
  expect(next.get('c')).toMatchObject({ x: 160, y: 8 })
  expect(next.get('parent')).toMatchObject({ x: 0, y: 0 })
  for (const id of ['a', 'b']) {
    const body = next.get(id)
    const pinned = next.get('c')
    if (!body || !pinned) throw new Error('missing')
    expect(gap(body, pinned)).toBeGreaterThanOrEqual(SEPARATE_GAP)
  }
})
