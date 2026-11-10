import { expect, test } from '@playwright/test'
import { buildMapGraph, type MapGraph, type MapGraphNode } from '../src/shared/map-graph'
import {
  MAP_COLUMN_PITCH,
  MAP_LEFT,
  MAP_NODE_WIDTH,
  MAP_ROW_GAP,
  MAP_TOP,
  columnX,
  estimateMapNodeHeight,
  expansionPoints,
  layoutMapGraph,
  mapNodeSize,
  mapNodeSizes,
  placeNearParent,
  settleNewNodes,
  type MapPoint,
} from '../src/shared/map-layout'
import type { MapTask, TaskChainState } from '../src/shared/types'

function task(id: string, dateCreated: string, extra: Partial<MapTask> = {}): MapTask {
  return {
    id,
    text: id,
    dateCreated,
    dateCompleted: null,
    droppedAt: null,
    parentId: null,
    carriedFromId: null,
    chainId: id,
    orderIndex: 0,
    mapX: null,
    mapY: null,
    ...extra,
  }
}

function openState(id: string): TaskChainState {
  return { id, state: 'open', date: null, copyId: null, copyDate: null, carriedFromDay: null, carriedDays: 0 }
}

function graphOf(tasks: readonly MapTask[]): MapGraph {
  return buildMapGraph(tasks, tasks.map((item) => openState(item.id)), { expandAll: false, expanded: new Set() })
}

function emptyNode(id: string, date: string, chainId = id): MapGraphNode {
  return node(id, date, '', chainId)
}

function node(id: string, date: string, text: string, chainId = id): MapGraphNode {
  return {
    id,
    taskId: id,
    text,
    date,
    state: openState(id),
    chainId,
    copies: [id],
    count: 1,
    firstDate: date,
    lastDate: date,
    saved: null,
  }
}

function overlaps(a: MapPoint, b: MapPoint, ah: number, bh: number): boolean {
  return a.x < b.x + MAP_NODE_WIDTH && b.x < a.x + MAP_NODE_WIDTH && a.y < b.y + bh && b.y < a.y + ah
}

const day1 = '2026-11-01'
const day2 = '2026-11-02'
const day4 = '2026-11-04'

test('the layout puts each date in its own ascending column', () => {
  const graph = graphOf([task('c', day4), task('a', day1), task('b', day2)])
  const points = layoutMapGraph(graph, mapNodeSizes(graph))

  expect(points.get('a')).toEqual({ x: MAP_LEFT, y: MAP_TOP })
  expect(points.get('b')?.x).toBe(MAP_LEFT + MAP_COLUMN_PITCH)
  expect(points.get('c')?.x).toBe(MAP_LEFT + MAP_COLUMN_PITCH * 2)
  expect(columnX(day1, [day1, day2, day4])).toBe(MAP_LEFT)
  expect(columnX('2025-01-01', [day1, day2, day4])).toBe(MAP_LEFT)
})

test('a column stacks from the top edge with the row gap and estimated heights', () => {
  const tasks = [
    task('a1', day1),
    task('a2', day1, { chainId: 'a', carriedFromId: 'a1', text: 'Carried copy' }),
    task('b1', day1, { text: 'x\ny' }),
  ]
  const graph = buildMapGraph(tasks, tasks.map((item) => openState(item.id)), { expandAll: true, expanded: new Set() })
  const sizes = mapNodeSizes(graph)
  const points = layoutMapGraph(graph, sizes)

  const first = points.get('a1')
  const second = points.get('a2')
  const third = points.get('b1')
  expect(first?.y).toBe(MAP_TOP)
  expect(second?.y).toBe(MAP_TOP + (sizes.get('a1')?.height ?? 0) + MAP_ROW_GAP)
  expect(third?.y).toBe((second?.y ?? 0) + (sizes.get('a2')?.height ?? 0) + MAP_ROW_GAP)
  expect(sizes.get('a1')).toEqual({ width: MAP_NODE_WIDTH, height: estimateMapNodeHeight(graph.nodes[0] as MapGraphNode) })
  expect(mapNodeSize(graph.nodes[0] as MapGraphNode, new Map([['a1', { width: 99, height: 33 }]]))).toEqual({
    width: 99,
    height: 33,
  })
})

test('no two laid-out nodes overlap, even with branches feeding one column', () => {
  const graph = graphOf([
    task('p', day1),
    task('b1', day1, { parentId: 'p' }),
    task('b2', day1, { parentId: 'p', text: 'a much longer task line that wraps onto more canvas rows' }),
    task('c', day2, { parentId: 'b1' }),
    task('d', day4, { parentId: 'c' }),
  ])
  const sizes = mapNodeSizes(graph)
  const points = layoutMapGraph(graph, sizes)

  for (const a of graph.nodes) {
    for (const b of graph.nodes) {
      if (a.id >= b.id) continue
      const pa = points.get(a.id)
      const pb = points.get(b.id)
      expect(pa && pb && overlaps(pa, pb, sizes.get(a.id)?.height ?? 0, sizes.get(b.id)?.height ?? 0)).toBe(false)
    }
  }
})

test('a fresh node with a placed branch parent lands below and beside it', () => {
  const graph = graphOf([task('p', day1), task('c', day1, { parentId: 'p' })])
  const sizes = mapNodeSizes(graph)
  const placed = new Map<string, MapPoint>([['p', { x: 100, y: 200 }]])
  const parentHeight = sizes.get('p')?.height ?? 0

  expect(placeNearParent(graph.nodes[1] as MapGraphNode, graph, placed, sizes)).toEqual({
    x: 148,
    y: 200 + parentHeight + MAP_ROW_GAP,
  })
})

test('a fresh node follows a carry parent when no branch parent exists', () => {
  const tasks = [
    task('a1', day1, { chainId: 'a' }),
    task('b1', day1, { chainId: 'b', parentId: 'a1' }),
    task('b2', day2, { chainId: 'b', carriedFromId: 'b1' }),
  ]
  const graph = buildMapGraph(tasks, tasks.map((item) => openState(item.id)), { expandAll: true, expanded: new Set() })
  const sizes = mapNodeSizes(graph)
  const placed = new Map<string, MapPoint>([['b1', { x: 300, y: 120 }]])
  const target = graph.nodes.find((node) => node.id === 'b2') as MapGraphNode
  const parentHeight = sizes.get('b1')?.height ?? 0

  expect(placeNearParent(target, graph, placed, sizes)).toEqual({ x: 348, y: 120 + parentHeight + MAP_ROW_GAP })
})

test('a fresh node without a placed parent drops below the last node of its own column', () => {
  const graph = graphOf([task('a', day1), task('b', day2), task('q', day2)])
  const sizes = mapNodeSizes(graph)
  const placed = new Map<string, MapPoint>([
    ['a', { x: MAP_LEFT, y: 500 }],
    ['b', { x: MAP_LEFT + MAP_COLUMN_PITCH, y: MAP_TOP }],
  ])
  const target = graph.nodes.find((node) => node.id === 'q') as MapGraphNode
  const bHeight = sizes.get('b')?.height ?? 0

  expect(placeNearParent(target, graph, placed, sizes)).toEqual({
    x: MAP_LEFT + MAP_COLUMN_PITCH,
    y: MAP_TOP + bHeight + MAP_ROW_GAP,
  })
})

test('expanding a chain keeps the representative copy exactly where the chain sat', () => {
  const tasks = chainTasks()
  const collapsed = buildMapGraph(tasks, tasks.map((item) => openState(item.id)), {
    expandAll: false,
    expanded: new Set(),
  })
  const expanded = buildMapGraph(tasks, tasks.map((item) => openState(item.id)), {
    expandAll: false,
    expanded: new Set(['a']),
  })
  const chainNode = collapsed.nodes[0] as MapGraphNode
  const points = expansionPoints(chainNode, expanded.nodes, { x: 640, y: 310 }, expanded)

  expect(points.get('a3')).toEqual({ x: 640, y: 310 })
  expect(points.get('a1')).toEqual({ x: MAP_LEFT, y: 310 })
  expect(points.get('a2')).toEqual({ x: MAP_LEFT + MAP_COLUMN_PITCH, y: 310 })
})

test('settling moves only the new node and never touches a placed one', () => {
  const graph = graphOf([task('old', day1), task('new', day1)])
  const sizes = mapNodeSizes(graph)
  const oldHeight = sizes.get('old')?.height ?? 0
  const base = new Map<string, MapPoint>([
    ['old', { x: MAP_LEFT, y: MAP_TOP }],
    ['new', { x: MAP_LEFT + 4, y: MAP_TOP + 10 }],
  ])

  const settled = settleNewNodes(base, graph, sizes, ['new'])

  expect(settled.get('old')).toEqual({ x: MAP_LEFT, y: MAP_TOP })
  const moved = settled.get('new') as MapPoint
  expect(moved).not.toEqual(base.get('new'))
  expect(overlaps(moved, { x: MAP_LEFT, y: MAP_TOP }, oldHeight, sizes.get('new')?.height ?? 0)).toBe(false)

  const untouched = settleNewNodes(base, graph, sizes, [])
  expect(untouched).toEqual(base)
})

test('estimated height grows with every wrapped line', () => {
  const one = estimateMapNodeHeight(emptyNode('a', day1))
  const two = estimateMapNodeHeight(emptyNode('b', day1))
  const wide = emptyNode('c', day1)

  expect(two).toBe(one)
  expect(estimateMapNodeHeight({ ...wide, text: 'x\ny' })).toBe(one + 19)
  expect(estimateMapNodeHeight({ ...wide, text: 'x\ny\nz' })).toBe(one + 19 * 2)
  expect(estimateMapNodeHeight({ ...wide, text: '' })).toBe(one)
  // 13 wide characters weigh 26 units and still fit one line; 14 wrap to two
  expect(estimateMapNodeHeight({ ...wide, text: '面'.repeat(13) })).toBe(one)
  expect(estimateMapNodeHeight({ ...wide, text: '面'.repeat(14) })).toBe(one + 19)
})

function chainTasks(): MapTask[] {
  return [
    task('a1', day1, { chainId: 'a' }),
    task('a2', day2, { chainId: 'a', carriedFromId: 'a1' }),
    task('a3', day4, { chainId: 'a', carriedFromId: 'a2' }),
  ]
}
