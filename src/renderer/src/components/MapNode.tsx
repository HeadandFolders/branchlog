import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Check, CheckCheck, CircleSlash2, CornerUpRight } from 'lucide-react'
import type { MapGraphNode } from '@shared/map-graph'
import { textDirection } from '../lib/direction'
import { carriedLabel, droppedLabel, finishedLaterLabel, shortDate } from '../lib/state-label'
import { useMap } from '../store/map'
import { usePreferences } from '../store/preferences'

function stateSummary(node: MapGraphNode): string {
  const state = node.state
  if (state.state === 'finished-later' && state.date) return finishedLaterLabel(state.date)
  if (state.state === 'dropped' && state.date) return droppedLabel(state.date)
  if (state.state === 'done') return 'Done'
  if (state.state === 'open' && state.carriedFromDay && state.carriedDays > 0) {
    return carriedLabel(state.carriedFromDay, state.carriedDays)
  }
  return ''
}

function dateSummary(node: MapGraphNode): string {
  if (node.count > 1) return `${shortDate(node.firstDate)} – ${shortDate(node.lastDate)}`
  return shortDate(node.date)
}

export const MapNode = memo(function MapNode({ id }: NodeProps) {
  const node = useMap((state) => state.nodesById.get(id))
  const chain = useMap((state) => (node ? state.chains.get(node.chainId) : undefined))
  const expanded = useMap((state) => (node ? state.expanded.has(node.chainId) : false))
  const toggleExpanded = useMap((state) => state.toggleExpanded)
  const expandAll = usePreferences((state) => state.mapExpandChains)
  if (!node) return null

  const state = node.state
  const summary = stateSummary(node)
  const dates = dateSummary(node)
  const carried = state.state === 'open' && state.carriedFromDay !== null && state.carriedDays > 0
  const chainCount = chain?.count ?? 1
  const showExpand = node.count > 1
  const showCollapse =
    node.count === 1 &&
    chainCount > 1 &&
    !expandAll &&
    expanded &&
    chain !== undefined &&
    node.taskId === chain.latestId
  const tooltip = [node.text === '' ? 'Empty task' : node.text, summary, dates].filter(Boolean).join('\n')

  return (
    <div className="map-node" data-state={state.state} title={tooltip}>
      <span className="map-node-text" dir={textDirection(node.text)}>
        {node.text === '' ? 'Empty task' : node.text}
      </span>
      <span className="map-node-meta">
        <span className="map-node-date">{dates}</span>
        <span className="map-node-marks">
          {carried && state.carriedFromDay ? (
            <span
              className="map-node-mark"
              data-mark="carried"
              role="img"
              aria-label={carriedLabel(state.carriedFromDay, state.carriedDays)}
              title={carriedLabel(state.carriedFromDay, state.carriedDays)}
            >
              <CornerUpRight size={12} strokeWidth={1.5} />
            </span>
          ) : null}
          {state.state === 'done' ? (
            <span className="map-node-mark" data-mark="done" role="img" aria-label="Done" title="Done">
              <Check size={12} strokeWidth={2} />
            </span>
          ) : null}
          {state.state === 'finished-later' ? (
            <span
              className="map-node-mark"
              data-mark="finished-later"
              role="img"
              aria-label={summary}
              title={summary}
            >
              <CheckCheck size={12} strokeWidth={2} />
            </span>
          ) : null}
          {state.state === 'dropped' ? (
            <span className="map-node-mark" data-mark="dropped" role="img" aria-label={summary} title={summary}>
              <CircleSlash2 size={12} strokeWidth={1.5} />
            </span>
          ) : null}
          {showExpand || showCollapse ? (
            <button
              type="button"
              className="map-badge nodrag nopan"
              data-map-badge={showExpand ? 'expand' : 'collapse'}
              aria-expanded={showCollapse}
              aria-label={
                showExpand
                  ? `Carried across ${node.count} days. Activate to expand.`
                  : `Carried across ${chainCount} days. Activate to collapse.`
              }
              title={showExpand ? `Show the ${node.count} copies` : `Collapse the ${chainCount} copies`}
              onClick={(event) => {
                event.stopPropagation()
                toggleExpanded(node.chainId)
              }}
            >
              {showExpand ? node.count : chainCount} days
            </button>
          ) : null}
        </span>
      </span>
      <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
    </div>
  )
})