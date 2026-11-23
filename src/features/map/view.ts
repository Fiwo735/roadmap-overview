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

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Fly to `point`, ending at a zoom between `minZoom` (so a place is never left as a dot on a
 * continent) and `maxZoom` (so a far-away pick does not land at street level); the current zoom
 * is kept when it already lies in between. No animation when the user prefers reduced motion.
 */
export function flyToPoint(
  map: LeafletMap,
  point: { lat: number; lng: number },
  { minZoom = 10, maxZoom = 14 }: { minZoom?: number; maxZoom?: number } = {},
): void {
  const zoom = Math.min(Math.max(map.getZoom(), minZoom), maxZoom)
  if (prefersReducedMotion()) map.setView([point.lat, point.lng], zoom, { animate: false })
  else map.flyTo([point.lat, point.lng], zoom, { duration: 0.9 })
}
