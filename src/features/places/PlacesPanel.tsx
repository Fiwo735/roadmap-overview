import { MapPinned } from 'lucide-react'

// Sidebar content: the sortable places list with search, days and leg rows (feature F1).
// Until then, a friendly empty state.
export function PlacesPanel() {
  return (
    <div className="empty-state" data-testid="places-empty">
      <span className="empty-state__icon" aria-hidden="true">
        <MapPinned size={28} strokeWidth={1.75} />
      </span>
      <h2 className="empty-state__title">No stops yet</h2>
      <p className="empty-state__text">
        Your trip starts here. Stops you add are listed in travel order, with the route between them.
      </p>
    </div>
  )
}
