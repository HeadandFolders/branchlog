import { expect, test } from '@playwright/test'
import { buildMapGraph } from '../src/shared/map-graph'
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

function openState(id: string, carriedDays = 0, carriedFromDay: string | null = null): TaskChainState {
  return { id, state: 'open', date: null, copyId: null, copyDate: null, carriedFromDay, carriedDays }
}

function statesOf(tasks: readonly MapTask[]): TaskChainState[] {
  return tasks.map((item) => openState(item.id))
}

const day1 = '2026-11-01'
const day2 = '2026-11-02'
const day4 = '2026-11-04'

function chainTasks(): MapTask[] {
  return [
    task('a1', day1, { chainId: 'a' }),
    task('a2', day2, { chainId: 'a', carriedFromId: 'a1' }),
    task('a3', day4, { chainId: 'a', carriedFromId: 'a2', text: 'Milk' }),
  ]
}

test('a multi-copy chain collapses into one node keyed by the chain id', () => {
  const tasks = chainTasks()
  const graph = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set() })

  expect(graph.nodes).toHaveLength(1)
  const node = graph.nodes[0]
  expect(node?.id).toBe('a')
  expect(node?.taskId).toBe('a3')
  expect(node?.text).toBe('Milk')
  expect(node?.date).toBe(day4)
  expect(node?.count).toBe(3)
  expect(node?.copies).toEqual(['a1', 'a2', 'a3'])
  expect(node?.firstDate).toBe(day1)
  expect(node?.lastDate).toBe(day4)
  for (const id of ['a1', 'a2', 'a3']) expect(graph.nodeIdByTaskId.get(id)).toBe('a')
})

test('copies order by date even when rows arrive shuffled, and the latest copy wins', () => {
  const tasks = [
    task('a3', day4, { chainId: 'a', carriedFromId: 'a2', text: 'latest' }),
    task('a1', day1, { chainId: 'a', text: 'first' }),
    task('a2', day2, { chainId: 'a', carriedFromId: 'a1' }),
  ]
  const graph = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set() })

  const node = graph.nodes[0]
  expect(node?.taskId).toBe('a3')
  expect(node?.text).toBe('latest')
  expect(node?.copies).toEqual(['a1', 'a2', 'a3'])
  expect(node?.saved).toBeNull()
})

test('a chain with one copy is a plain node and a saved position rides along', () => {
  const tasks = [task('b1', day1, { mapX: 140, mapY: 220 })]
  const graph = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set() })

  expect(graph.nodes).toHaveLength(1)
  expect(graph.nodes[0]?.id).toBe('b1')
  expect(graph.nodes[0]?.count).toBe(1)
  expect(graph.nodes[0]?.saved).toEqual({ x: 140, y: 220 })
})

test('an expanded chain becomes one node per copy, each keyed by its own id', () => {
  const tasks = chainTasks()
  const graph = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set(['a']) })

  expect(graph.nodes.map((node) => node.id)).toEqual(['a1', 'a2', 'a3'])
  for (const node of graph.nodes) {
    expect(node.count).toBe(1)
    expect(node.chainId).toBe('a')
  }
  expect(graph.nodeIdByTaskId.get('a2')).toBe('a2')
})

test('expandAll shows every copy of every chain without touching the expanded set', () => {
  const tasks = [...chainTasks(), task('b1', day2), task('b2', day4, { chainId: 'b', carriedFromId: 'b1' })]
  const graph = buildMapGraph(tasks, statesOf(tasks), { expandAll: true, expanded: new Set() })

  expect(graph.nodes).toHaveLength(5)
  expect(graph.nodes.every((node) => node.count === 1)).toBe(true)
})

test('parentId is a branch link and carriedFromId is a carry link', () => {
  const tasks = [
    task('p', day1),
    task('child', day1, { parentId: 'p' }),
    ...chainTasks(),
  ]
  const collapsed = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set() })

  const branch = collapsed.links.find((link) => link.targetTaskId === 'child')
  expect(branch?.kind).toBe('branch')
  expect(branch?.source).toBe('p')
  expect(branch?.target).toBe('child')
  // A carry inside one collapsed chain stays within its own node, so nothing is drawn for it yet.
  expect(collapsed.links.filter((link) => link.kind === 'carry')).toHaveLength(0)

  const open = buildMapGraph(tasks, statesOf(tasks), { expandAll: true, expanded: new Set() })
  const carry = open.links.find((link) => link.targetTaskId === 'a3')
  expect(carry?.kind).toBe('carry')
  expect(carry?.sourceTaskId).toBe('a2')
  expect(carry?.source).toBe('a2')
  expect(carry?.target).toBe('a3')
})

test('links that collapse onto the same pair are drawn once, and separate when the chain is open', () => {
  // Bread was branched from the first copy and carried on; its copy was branched from the second.
  const tasks: MapTask[] = [
    ...chainTasks(),
    task('q1', day4, { chainId: 'q', parentId: 'a1', text: 'from the first day' }),
    task('q2', day4, { chainId: 'q', parentId: 'a2', carriedFromId: 'q1', text: 'the same task later' }),
  ]
  const collapsed = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set() })
  expect(collapsed.links.map((link) => `${link.kind}:${link.source}->${link.target}`)).toEqual(['branch:a->q'])

  const open = buildMapGraph(tasks, statesOf(tasks), { expandAll: true, expanded: new Set() })
  expect(
    open.links
      .filter((link) => link.kind === 'branch')
      .map((link) => `${link.source}->${link.target}`)
      .sort(),
  ).toEqual(['a1->q1', 'a2->q2'])
  expect(
    open.links
      .filter((link) => link.kind === 'carry')
      .map((link) => `${link.source}->${link.target}`)
      .sort(),
  ).toEqual(['a1->a2', 'a2->a3', 'q1->q2'])
})

test('links inside one collapsed chain are skipped', () => {
  const tasks = chainTasks()
  const graph = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set() })

  expect(graph.links).toHaveLength(0)

  const doubled = [...tasks, task('a3b', day4, { chainId: 'a', carriedFromId: 'a2', orderIndex: 1 })]
  const secondGraph = buildMapGraph(doubled, statesOf(doubled), { expandAll: false, expanded: new Set() })
  expect(secondGraph.links).toHaveLength(0)
})

test('a link to a task that is not there is skipped, not crashed', () => {
  const tasks = [task('orphan', day1, { parentId: 'gone', carriedFromId: 'alsoGone' })]
  const graph = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set() })

  expect(graph.nodes).toHaveLength(1)
  expect(graph.links).toHaveLength(0)
})

test('the collapsed node carries the state of its latest copy', () => {
  const tasks = chainTasks()
  const states: TaskChainState[] = [
    openState('a1'),
    openState('a2'),
    { id: 'a3', state: 'done', date: day4, copyId: null, copyDate: null, carriedFromDay: day1, carriedDays: 3 },
  ]
  const graph = buildMapGraph(tasks, states, { expandAll: false, expanded: new Set() })

  expect(graph.nodes[0]?.state.state).toBe('done')
  expect(graph.nodes[0]?.state.carriedDays).toBe(3)
})

test('dateColumns are the distinct node dates in ascending order', async () => {
  const { dateColumns } = await import('../src/shared/map-graph')
  const tasks = [task('b', day4), task('a', day1), task('c', day2), task('d', day1)]
  const graph = buildMapGraph(tasks, statesOf(tasks), { expandAll: false, expanded: new Set() })

  expect(dateColumns(graph.nodes)).toEqual([day1, day2, day4])
})
