import type { LatLngBoundsExpression, LatLngTuple, Map as LeafletMap, PointExpression } from 'leaflet'
import type { Place } from '../../types/trip'
import { boundsOf } from '../../lib/geo'

/** Europe-wide view for an empty trip. */
export const DEFAULT_CENTER: LatLngTuple = [50, 10]
export const DEFAULT_ZOOM = 4

const FIT_PADDING: PointExpression = [48, 48]
const SINGLE_PLACE_ZOOM = 10
const FIT_MAX_ZOOM = 12

type PlaceCoords = Pick<Place, 'lat' | 'lng'>

export type MapView =
  | { center: LatLngTuple; zoom: number }
  | { bounds: LatLngBoundsExpression; boundsOptions: { padding: PointExpression; maxZoom: number } }

/**
 * Props for a MapContainer showing `places`: fit them, or the default Europe view when empty.
 * (MapContainer prefers center/zoom over bounds when both are given, hence the exclusive variants.)
 */
export function viewForPlaces(places: readonly PlaceCoords[]): MapView {
  const b = boundsOf(places)
  if (!b) return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }
  if (b.south === b.north && b.west === b.east) return { center: [b.south, b.west], zoom: SINGLE_PLACE_ZOOM }
  return {
    bounds: [
      [b.south, b.west],
      [b.north, b.east],
    ],
    boundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
  }
}

/** Move an existing map to show `places` (or Europe when empty). */
export function fitMapToPlaces(map: LeafletMap, places: readonly PlaceCoords[], animate = true): void {
  const view = viewForPlaces(places)
  if ('bounds' in view) map.fitBounds(view.bounds, { ...view.boundsOptions, animate })
  else map.setView(view.center, view.zoom, { animate })
}
