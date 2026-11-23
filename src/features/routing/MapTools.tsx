import { Maximize, Tags } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { fitMapToTrip } from './mapFit'
import './routing.css'

/** Map overlay (top-right): fit the map to the whole trip, show/hide the place labels. */
export function MapTools() {
  const hasPlaces = useTripStore((s) => s.trip.places.length > 0)
  const showLabels = useUiStore((s) => s.showLabels)
  const setShowLabels = useUiStore((s) => s.setShowLabels)

  return (
    <div className="map-tools" role="toolbar" aria-label="Map tools" data-testid="map-tools">
      <IconButton
        label="Fit to trip"
        icon={<Maximize size={18} />}
        disabled={!hasPlaces}
        onClick={() => fitMapToTrip()}
        data-testid="fit-trip"
      />
      <IconButton
        label="Show labels"
        tooltip={showLabels ? 'Hide place labels' : 'Show place labels'}
        icon={<Tags size={18} />}
        aria-pressed={showLabels}
        onClick={() => setShowLabels(!showLabels)}
        data-testid="toggle-labels"
      />
    </div>
  )
}
