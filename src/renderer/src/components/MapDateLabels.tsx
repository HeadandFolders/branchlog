import { ViewportPortal } from '@xyflow/react'
import { dateColumns } from '@shared/map-graph'
import { columnX, MAP_NODE_WIDTH, MAP_TOP } from '@shared/map-layout'
import { shortDate } from '../lib/state-label'
import { useMap } from '../store/map'

export function MapDateLabels() {
  const graph = useMap((state) => state.graph)
  if (!graph || graph.nodes.length === 0) return null
  const columns = dateColumns(graph.nodes)
  return (
    <ViewportPortal>
      <div className="map-date-labels" aria-hidden="true">
        {columns.map((date) => (
          <span
            key={date}
            className="map-date-label"
            style={{ left: columnX(date, columns), top: MAP_TOP - 32, width: MAP_NODE_WIDTH }}
          >
            {shortDate(date)}
          </span>
        ))}
      </div>
    </ViewportPortal>
  )
}