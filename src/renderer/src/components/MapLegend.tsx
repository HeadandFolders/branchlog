import { Minus } from 'lucide-react'
import { useMap } from '../store/map'

export function MapLegend() {
  const open = useMap((state) => state.legendOpen)
  const toggle = useMap((state) => state.toggleLegend)

  if (!open) {
    return (
      <button type="button" className="map-legend-chip" aria-expanded={false} onClick={toggle}>
        Legend
      </button>
    )
  }

  return (
    <div className="map-legend" role="note" aria-label="Map legend">
      <button type="button" className="map-legend-hide" aria-label="Collapse legend" onClick={toggle}>
        <Minus size={12} strokeWidth={1.5} />
      </button>
      <div className="map-legend-row">
        <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
          <line x1="0" y1="5" x2="23" y2="5" className="map-legend-line" />
          <path d="M 22 1.5 L 29 5 L 22 8.5 z" className="map-legend-head" />
        </svg>
        <span>Branched from</span>
      </div>
      <div className="map-legend-row">
        <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
          <line x1="0" y1="5" x2="24" y2="5" className="map-legend-line map-legend-carry" strokeDasharray="3 3" />
          <path d="M 24 2.5 L 29 5 L 24 7.5 z" className="map-legend-head map-legend-carry" />
        </svg>
        <span>Same task, carried to another day</span>
      </div>
    </div>
  )
}