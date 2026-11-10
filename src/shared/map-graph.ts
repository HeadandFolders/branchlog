import type { MapTask, TaskChainState } from './types'

export interface MapGraphNode {
  id: string
  taskId: string
  text: string
  date: string
  state: TaskChainState
  chainId: string
  copies: string[]
  count: number
  firstDate: string
  lastDate: string
  saved: { x: number; y: number } | null
}

export type MapLinkKind = 'branch' | 'carry'

export interface MapGraphLink {
  id: string
  kind: MapLinkKind
  source: string
  target: string
  sourceTaskId: string
  targetTaskId: string
}

export interface MapGraph {
  nodes: MapGraphNode[]
  links: MapGraphLink[]
  nodeIdByTaskId: ReadonlyMap<string, string>
}

export interface CollapseOptions {
  expandAll: boolean
  expanded: ReadonlySet<string>
}

function compareCopies(a: MapTask, b: MapTask): number {
  return (
    a.dateCreated.localeCompare(b.dateCreated) ||
    a.orderIndex - b.orderIndex ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

export function dateColumns(nodes: readonly MapGraphNode[]): string[] {
  return [...new Set(nodes.map((node) => node.date))].sort()
}

export function buildMapGraph(
  tasks: readonly MapTask[],
  states: readonly TaskChainState[],
  options: CollapseOptions,
): MapGraph {
  const stateById = new Map(states.map((state) => [state.id, state]))
  const chains = new Map<string, MapTask[]>()
  for (const task of tasks) {
    const chain = chains.get(task.chainId)
    if (chain) chain.push(task)
    else chains.set(task.chainId, [task])
  }

  const nodes: MapGraphNode[] = []
  const nodeIdByTaskId = new Map<string, string>()
  for (const [chainId, chain] of chains) {
    chain.sort(compareCopies)
    const latest = chain[chain.length - 1]
    if (!latest) continue
    const firstDate = chain[0]?.dateCreated ?? latest.dateCreated
    if (chain.length === 1 || options.expandAll || options.expanded.has(chainId)) {
      for (const task of chain) {
        nodes.push({
          id: task.id,
          taskId: task.id,
          text: task.text,
          date: task.dateCreated,
          state: stateById.get(task.id) as TaskChainState,
          chainId,
          copies: [task.id],
          count: 1,
          firstDate: task.dateCreated,
          lastDate: task.dateCreated,
          saved: task.mapX !== null && task.mapY !== null ? { x: task.mapX, y: task.mapY } : null,
        })
        nodeIdByTaskId.set(task.id, task.id)
      }
    } else {
      nodes.push({
        id: chainId,
        taskId: latest.id,
        text: latest.text,
        date: latest.dateCreated,
        state: stateById.get(latest.id) as TaskChainState,
        chainId,
        copies: chain.map((task) => task.id),
        count: chain.length,
        firstDate,
        lastDate: latest.dateCreated,
        saved: latest.mapX !== null && latest.mapY !== null ? { x: latest.mapX, y: latest.mapY } : null,
      })
      for (const task of chain) nodeIdByTaskId.set(task.id, chainId)
    }
  }

  const links: MapGraphLink[] = []
  const seen = new Set<string>()
  const addLink = (kind: MapLinkKind, sourceTaskId: string, targetTaskId: string): void => {
    const source = nodeIdByTaskId.get(sourceTaskId)
    const target = nodeIdByTaskId.get(targetTaskId)
    if (!source || !target || source === target) return
    const id = `${kind}:${source}->${target}`
    if (seen.has(id)) return
    seen.add(id)
    links.push({ id, kind, source, target, sourceTaskId, targetTaskId })
  }
  for (const task of tasks) {
    if (task.parentId !== null) addLink('branch', task.parentId, task.id)
    if (task.carriedFromId !== null) addLink('carry', task.carriedFromId, task.id)
  }

  return { nodes, links, nodeIdByTaskId }
}