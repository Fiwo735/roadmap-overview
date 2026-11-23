import type { LatLng, LegMode, LegRoute } from '../types/trip'
import { pathLengthM } from './geo'
import { estimateDurationS } from './modes'
import { encodePolyline } from './polyline'
import { legRouteKey } from './routeKey'

/** The points a leg is drawn through when nothing smarter is known: places and via points, in order. */
export const straightPath = (from: LatLng, via: readonly LatLng[], to: LatLng): LatLng[] =>
  [from, ...via, to].map(({ lat, lng }) => ({ lat, lng }))

/**
 * A route that needs no router: straight segments through the via points. Distance is the sum of
 * haversine lengths and the duration comes from the mode's speed estimate (`estimateDurationS`).
 * For 'drive' this is the "straight line" fallback (the leg's `straight` flag); the other modes
 * will draw their own shapes here (great-circle arcs for flights, …) — this is the one place to
 * extend. Pure and synchronous, so it never goes through the route store.
 */
export function computeManualRoute(from: LatLng, via: readonly LatLng[], to: LatLng, mode: LegMode): LegRoute {
  const path = straightPath(from, via, to)
  const distanceM = pathLengthM(path)
  return {
    key: legRouteKey(from, to, { mode, via: [...via], straight: mode === 'drive' }),
    geometry: encodePolyline(path),
    distanceM,
    durationS: estimateDurationS(mode, distanceM),
    source: 'manual',
  }
}
