// Builders for the stats unit tests: places, trips and the leg routes `getLegRoutes()` would give.
import { encodePolyline } from '../../lib/polyline'
import { legRouteKey } from '../../lib/routeKey'
import { syncLegs } from '../../lib/trip'
import type { LatLng, Leg, LegRoute, Place, RouteSpan, Trip } from '../../types/trip'
import { resolveLegRoutes, type LegRouteInfo } from '../routing/legRoutes'

export const place = (id: string, lat: number, lng: number, day = 0): Place => ({ id, name: id, lat, lng, day })

/** A trip through `places` whose legs (drive unless patched by index) follow the invariant. */
export function makeTrip(places: Place[], legPatches: Record<number, Partial<Leg>> = {}): Trip {
  let n = 0
  const legs = syncLegs(places, [], () => `leg${n++}`).map((leg, i) => ({ ...leg, ...legPatches[i] }))
  return { id: 't', title: 'Test', places, legs }
}

export interface RouteSpec {
  /** Geometry of the route; a straight line between the leg's places by default. */
  points?: LatLng[]
  distanceM?: number
  durationS?: number
  spans?: RouteSpan[]
}

/**
 * What `getLegRoutes()` returns for `trip`: legs whose index is in `routes` have that road route,
 * those in `failed` are errors, the other road legs are still loading (manual legs are always known).
 */
export function legRoutesOf(trip: Trip, routes: Record<number, RouteSpec> = {}, failed: number[] = []): LegRouteInfo[] {
  const cache: Record<string, LegRoute> = {}
  const status: Record<string, 'loading' | 'error'> = {}
  trip.legs.forEach((leg, i) => {
    const from = trip.places.find((p) => p.id === leg.fromId) as Place
    const to = trip.places.find((p) => p.id === leg.toId) as Place
    const key = legRouteKey(from, to, leg)
    const spec = routes[i]
    if (spec) {
      const points = spec.points ?? [from, ...leg.via, to]
      cache[key] = {
        key,
        geometry: encodePolyline(points),
        distanceM: spec.distanceM ?? 100_000,
        durationS: spec.durationS ?? 3_600,
        source: 'osrm',
        spans: spec.spans,
      }
    } else if (failed.includes(i)) status[key] = 'error'
  })
  return resolveLegRoutes(trip.places, trip.legs, { routes: cache, status, errors: {} })
}
