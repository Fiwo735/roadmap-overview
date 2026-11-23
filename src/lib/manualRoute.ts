import type { LatLng, LegMode, LegRoute } from '../types/trip'
import { pathLengthM } from './geo'
import { greatCirclePathThrough } from './greatCircle'
import { estimateDurationS } from './modes'
import { encodePolyline } from './polyline'
import { legRouteKey } from './routeKey'

/** The points a leg is drawn through when nothing smarter is known: places and via points, in order. */
export const straightPath = (from: LatLng, via: readonly LatLng[], to: LatLng): LatLng[] =>
  [from, ...via, to].map(({ lat, lng }) => ({ lat, lng }))

/**
 * The line a leg is drawn along when no router is involved: straight segments through the via points
 * (ferries, trains and straight drives), or a great-circle arc between each pair of points (flights).
 */
export function manualPath(from: LatLng, via: readonly LatLng[], to: LatLng, mode: LegMode): LatLng[] {
  const through = straightPath(from, via, to)
  return mode === 'flight' ? greatCirclePathThrough(through) : through
}

/**
 * A route that needs no router (see `manualPath` for the shapes). The distance is measured along the
 * drawn geometry and the duration comes from the mode's speed estimate (`estimateDurationS`). For
 * 'drive' this is the "straight line" fallback (the leg's `straight` flag). Pure and synchronous, so
 * it never goes through the route store.
 */
export function computeManualRoute(from: LatLng, via: readonly LatLng[], to: LatLng, mode: LegMode): LegRoute {
  const path = manualPath(from, via, to, mode)
  const distanceM = pathLengthM(path)
  return {
    key: legRouteKey(from, to, { mode, via: [...via], straight: mode === 'drive' }),
    geometry: encodePolyline(path),
    distanceM,
    durationS: estimateDurationS(mode, distanceM),
    source: 'manual',
  }
}
