import type { Map as LeafletMap } from 'leaflet'
import type { useRouteStore } from '../store/routeStore'
import type { useTripStore } from '../store/tripStore'
import type { useUiStore } from '../store/uiStore'

/**
 * Dev-only inspection/driving hook (`window.__ROADMAP__`), used by Playwright and by humans in the
 * console. Each entry is the Zustand store itself: `__ROADMAP__.trip.getState().trip`,
 * `__ROADMAP__.trip.getState().addPlace(...)`, `__ROADMAP__.trip.temporal.getState().undo()`.
 */
export interface RoadmapDebug {
  trip: typeof useTripStore
  ui: typeof useUiStore
  routes: typeof useRouteStore
  /** The Leaflet map, or null before it has mounted. */
  getMap: () => LeafletMap | null
}

declare global {
  interface Window {
    __ROADMAP__?: RoadmapDebug
  }
}
