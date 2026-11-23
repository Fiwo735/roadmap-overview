import { ChevronDown } from 'lucide-react'
import { useTripStore } from '../../store/tripStore'
import { useStatsCardStore } from './statsCardStore'
import { TripCard } from './TripCard'
import './stats.css'

/** The title and statistics card, or — when the user folded it away — a compact pill with the title. */
function TripPill() {
  const title = useTripStore((s) => s.trip.title)
  const setCollapsed = useStatsCardStore((s) => s.setCollapsed)
  return (
    <button
      type="button"
      className="trip-pill"
      data-testid="trip-pill"
      aria-label={`Show trip summary: ${title || 'Untitled trip'}`}
      aria-expanded="false"
      onClick={() => setCollapsed(false)}
    >
      <span className={['trip-pill__title', title ? '' : 'is-empty'].filter(Boolean).join(' ')}>{title || 'Untitled trip'}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
  )
}

// Map overlay (top-left): the trip's title and statistics card (feature F4).
export function StatsOverlay() {
  const collapsed = useStatsCardStore((s) => s.collapsed)
  return collapsed ? <TripPill /> : <TripCard />
}
