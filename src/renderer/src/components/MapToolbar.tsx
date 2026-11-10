import { useMap } from '../store/map'
import { usePreferences } from '../store/preferences'
import { useView } from '../store/view'

interface MapToolbarProps {
  onFit: () => void
}

export function MapToolbar({ onFit }: MapToolbarProps) {
  const showDaily = useView((state) => state.showDaily)
  const ready = useMap((state) => state.status === 'ready' && (state.graph?.nodes.length ?? 0) > 0)
  const rearrange = useMap((state) => state.rearrange)
  const expandAll = usePreferences((state) => state.mapExpandChains)
  const setExpandAll = usePreferences((state) => state.setMapExpandChains)

  return (
    <div className="map-toolbar" role="toolbar" aria-label="Concept map">
      <button type="button" className="map-tool" onClick={showDaily}>
        Back
      </button>
      <span className="map-tool-sep" aria-hidden="true" />
      <button type="button" className="map-tool" disabled={!ready} onClick={rearrange}>
        Re-arrange
      </button>
      <button type="button" className="map-tool" disabled={!ready} onClick={onFit}>
        Fit
      </button>
      <span className="map-tool-sep" aria-hidden="true" />
      <button
        type="button"
        role="switch"
        aria-checked={expandAll}
        className="map-tool map-switch"
        onClick={() => setExpandAll(!expandAll)}
      >
        Show carried copies
      </button>
    </div>
  )
}