import { expect, test } from '@playwright/test'
import { compactNearby } from '../src/shared/compact'
import { SEPARATE_GAP, type SeparateBody, type SeparateMove } from '../src/shared/separate'

function box(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 40,
  extra: Partial<SeparateBody> = {},
): SeparateBody {
  return { id, x, y, width, height, fixed: false, pinned: false, parentId: null, ...extra }
}

function expectClear(bodies: readonly SeparateBody[]): void {
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i]!
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j]!
      const dx = Math.max(a.x - b.x - b.width, b.x - a.x - a.width)
      const dy = Math.max(a.y - b.y - b.height, b.y - a.y - a.height)
      expect(Math.max(dx, dy), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(SEPARATE_GAP)
    }
  }
}

function compact(
  bodies: readonly SeparateBody[],
  changedId: string,
  previousSize: { width: number; height: number },
  initiallyColliding = false,
): { moves: SeparateMove[]; next: SeparateBody[] } {
  if (!initiallyColliding) expectClear(bodies)
  const before = bodies.map((body) => ({ ...body }))
  const input = Object.freeze(bodies.map((body) => Object.freeze({ ...body })))
  const size = Object.freeze({ ...previousSize })
  const moves = compactNearby(input, changedId, size)
  expect(input).toEqual(before)
  expect(bodies).toEqual(before)
  expect(size).toEqual(previousSize)
  expect(new Set(moves.map((move) => move.id)).size).toBe(moves.length)
  for (const move of moves) expect(bodies.some((body) => body.id === move.id)).toBe(true)
  const byId = new Map(moves.map((move) => [move.id, move]))
  const next = bodies.map((body) => ({ ...body, ...byId.get(body.id) }))
  expectClear(next)
  return { moves, next }
}

function ordered(moves: readonly SeparateMove[]): SeparateMove[] {
  return [...moves].sort((a, b) => a.id.localeCompare(b.id))
}

test('a sibling displaced below a tall branch returns to the nearest clear parent anchor', () => {
  const bodies = [
    box('parent', 0, 0, 200, 40, { fixed: true }),
    box('edited', 216, 0, 100, 40, { parentId: 'parent' }),
    box('sibling', 216, 416, 100, 80, { parentId: 'parent' }),
  ]
  const { moves } = compact(bodies, 'edited', { width: 100, height: 400 })
  expect(moves).toEqual([{ id: 'sibling', x: 216, y: 56 }])
})

test('a child follows its parent right edge after a width shrink and top-aligns', () => {
  const bodies = [
    box('parent', 0, 0, 200, 40, { fixed: true }),
    box('edited', 216, 0, 100, 40, { parentId: 'parent' }),
    box('child', 632, 0, 100, 80, { parentId: 'edited' }),
  ]
  const { moves } = compact(bodies, 'edited', { width: 400, height: 40 })
  expect(moves).toEqual([{ id: 'child', x: 332, y: 0 }])
})

for (const [name, extra] of [
  ['pinned branch', { pinned: true, parentId: 'parent' }],
  ['fixed branch', { fixed: true, parentId: 'parent' }],
  ['parentless image', {}],
] satisfies [string, Partial<SeparateBody>][]) {
  test(`the nearest candidate keeps the minimum gap around a ${name}`, () => {
    const bodies = [
      box('parent', 0, 0, 200, 40, { fixed: true }),
      box('edited', 216, -200, 100, 40, { parentId: 'parent' }),
      box('obstacle', 216, -40, 40, 160, extra),
      box('sibling', 500, 300, 100, 40, { parentId: 'parent' }),
    ]
    const { moves, next } = compact(bodies, 'edited', { width: 100, height: 140 })
    expect(moves).toEqual([{ id: 'sibling', x: 272, y: 0 }])
    const sibling = next.find((body) => body.id === 'sibling')!
    const obstacle = next.find((body) => body.id === 'obstacle')!
    expect(sibling.x - obstacle.x - obstacle.width).toBe(SEPARATE_GAP)
  })
}

test('the edited branch, immediate parent, pinned, fixed, and parentless bodies stay put', () => {
  const bodies = [
    box('root', 0, 0, 100, 40, { fixed: true }),
    box('parent', 400, 0, 200, 40, { parentId: 'root' }),
    box('edited', 616, 0, 100, 40, { parentId: 'parent' }),
    box('child', 1032, 0, 100, 40, { parentId: 'edited' }),
    box('pinned', 116, 300, 100, 40, { pinned: true, parentId: 'root' }),
    box('image', 332, 300),
    box('fixed', 500, 300, 100, 40, { fixed: true, parentId: 'root' }),
  ]
  const { moves, next } = compact(bodies, 'edited', { width: 400, height: 40 })
  expect(moves).toEqual([{ id: 'child', x: 732, y: 0 }])
  expect(next.filter((body) => body.id !== 'child')).toEqual(bodies.filter((body) => body.id !== 'child'))
})

test('branches outside the previous neighborhood on either axis are untouched', () => {
  const bodies = [
    box('parent', 0, 0, 200, 40, { fixed: true }),
    box('edited', 216, 0, 100, 40, { parentId: 'parent' }),
    box('child', 632, 0, 100, 40, { parentId: 'edited' }),
    box('far-x', 2000, 0, 100, 40, { parentId: 'parent' }),
    box('far-y', 216, 2000, 100, 80, { parentId: 'parent' }),
  ]
  const { moves } = compact(bodies, 'edited', { width: 400, height: 40 })
  expect(moves).toEqual([{ id: 'child', x: 332, y: 0 }])
})

test('previous height includes a sibling more than 720 away from the new footprint', () => {
  const bodies = [
    box('parent', 0, 0, 200, 40, { fixed: true }),
    box('edited', 216, 0, 100, 40, { parentId: 'parent' }),
    box('sibling', 216, 1016, 100, 80, { parentId: 'parent' }),
  ]
  expect(bodies[2]!.y - bodies[1]!.y - bodies[1]!.height).toBeGreaterThan(720)
  const { moves } = compact(bodies, 'edited', { width: 100, height: 1000 })
  expect(moves).toEqual([{ id: 'sibling', x: 216, y: 56 }])
})

test('the previous neighborhood includes its 720 boundary but not one pixel beyond it', () => {
  for (const [y, expected] of [
    [820, [{ id: 'sibling', x: 216, y: 56 }]],
    [821, []],
  ] satisfies [number, SeparateMove[]][]) {
    const bodies = [
      box('parent', 0, 0, 200, 40, { fixed: true }),
      box('edited', 216, 0, 100, 40, { parentId: 'parent' }),
      box('sibling', 216, y, 100, 80, { parentId: 'parent' }),
    ]
    const { moves } = compact(bodies, 'edited', { width: 100, height: 100 })
    expect(moves).toEqual(expected)
  }
})

test('nested parents compact before their children despite reverse depth and id order', () => {
  const bodies = [
    box('0-grandchild', 816, 200, 100, 40, { parentId: 'a-child' }),
    box('a-child', 700, 200, 100, 40, { parentId: 'z-parent' }),
    box('z-parent', 500, 200, 100, 40, { parentId: 'root' }),
    box('edited', 216, -200, 100, 40, { parentId: 'root' }),
    box('root', 0, 0, 200, 40, { fixed: true }),
  ]
  const { moves, next } = compact(bodies, 'edited', { width: 100, height: 140 })
  expect(ordered(moves)).toEqual([
    { id: '0-grandchild', x: 448, y: 0 },
    { id: 'a-child', x: 332, y: 0 },
    { id: 'z-parent', x: 216, y: 0 },
  ])
  expect(compact(next, 'edited', { width: 100, height: 140 }).moves).toEqual([])
})

test('compaction is repeatable, idempotent, and input-order independent for competing siblings', () => {
  const bodies = [
    box('parent', 0, 0, 200, 40, { fixed: true }),
    box('edited', 216, -200, 100, 40, { parentId: 'parent' }),
    box('a', 216, 300, 100, 40, { parentId: 'parent' }),
    box('b', 500, 300, 100, 80, { parentId: 'parent' }),
  ]
  const previousSize = { width: 100, height: 140 }
  const first = compact(bodies, 'edited', previousSize)
  expect(first.moves).toHaveLength(2)
  expect(compact(bodies, 'edited', previousSize).moves).toEqual(first.moves)
  for (const order of [
    [...bodies].reverse(),
    [bodies[2]!, bodies[0]!, bodies[3]!, bodies[1]!],
    [bodies[3]!, bodies[1]!, bodies[2]!, bodies[0]!],
  ]) {
    expect(compact(order, 'edited', previousSize).moves).toEqual(first.moves)
  }
  expect(compact(first.next, 'edited', previousSize).moves).toEqual([])
})

test('a branch already at the nearest clear point is not moved to an equal or worse point', () => {
  const bodies = [
    box('parent', 0, 0, 200, 40, { fixed: true }),
    box('edited', 216, 0, 100, 40, { parentId: 'parent' }),
    box('sibling', 216, 56, 100, 40, { parentId: 'parent' }),
  ]
  expect(compact(bodies, 'edited', { width: 100, height: 80 }).moves).toEqual([])
})

test('pre-existing collisions separate a parentless image while the edited branch is pinned', () => {
  const bodies = [
    box('parent', 0, 0, 200, 40, { fixed: true }),
    box('edited', 216, 0, 100, 40, { parentId: 'parent' }),
    box('image', 226, 8, 100, 80),
  ]
  const { moves } = compact(bodies, 'edited', { width: 100, height: 80 }, true)
  expect(moves).toEqual([{ id: 'image', x: 226, y: 56 }])
})
