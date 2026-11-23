import type { LatLngBoundsExpression, LatLngTuple, Map as LeafletMap, PointExpression } from 'leaflet'
import type { Place } from '../../types/trip'
import { boundsOf } from '../../lib/geo'
import { overlayInsets, type FitInsets } from './overlayInsets'

/** Europe-wide view for an empty trip. */
export const DEFAULT_CENTER: LatLngTuple = [50, 10]
export const DEFAULT_ZOOM = 4

const FIT_BASE_PADDING = 48
const FIT_PADDING: PointExpression = [FIT_BASE_PADDING, FIT_BASE_PADDING]
const SINGLE_PLACE_ZOOM = 10
const FIT_MAX_ZOOM = 12

type PlaceCoords = Pick<Place, 'lat' | 'lng'>

export type MapView =
  | { center: LatLngTuple; zoom: number }
  | {
      bounds: LatLngBoundsExpression
      boundsOptions: { padding?: PointExpression; paddingTopLeft?: PointExpression; paddingBottomRight?: PointExpression; maxZoom: number }
    }

/**
 * Props for a MapContainer showing `places`: fit them, or the default Europe view when empty.
 * (MapContainer prefers center/zoom over bounds when both are given, hence the exclusive variants.)
 * `insets` keeps the fit clear of overlays (see `overlayInsets`); without it the padding is even.
 */
export function viewForPlaces(places: readonly PlaceCoords[], insets?: FitInsets): MapView {
  const b = boundsOf(places)
  if (!b) return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }
  if (b.south === b.north && b.west === b.east) return { center: [b.south, b.west], zoom: SINGLE_PLACE_ZOOM }
  return {
    bounds: [
      [b.south, b.west],
      [b.north, b.east],
    ],
    boundsOptions: insets
      ? { paddingTopLeft: insets.topLeft, paddingBottomRight: insets.bottomRight, maxZoom: FIT_MAX_ZOOM }
      : { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
  }
}

/**
 * Move an existing map to show `places` (or Europe when empty), leaving room for the overlays that
 * cover the map's corners (the title card, the map tools): what is fitted ends up in the part that
 * stays visible, a lone place in the middle of it.
 */
export function fitMapToPlaces(map: LeafletMap, places: readonly PlaceCoords[], animate = true): void {
  const insets = overlayInsets(map, FIT_BASE_PADDING)
  const view = viewForPlaces(places, insets)
  if ('bounds' in view) {
    map.fitBounds(view.bounds, { ...view.boundsOptions, animate })
    return
  }
  // The middle of the visible part is off the middle of the map by half the difference of the insets.
  const shift = [(insets.topLeft[0] - insets.bottomRight[0]) / 2, (insets.topLeft[1] - insets.bottomRight[1]) / 2] as [number, number]
  const centre = map.unproject(map.project(view.center, view.zoom).subtract(shift), view.zoom)
  map.setView(centre, view.zoom, { animate })
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
