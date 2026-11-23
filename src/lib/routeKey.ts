import type { LatLng, Leg, LegRoute } from '../types/trip'

const point = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`

/**
 * Identifies the geometry a leg needs: same key ⇒ same route. Used as the route-cache key.
 * Depends only on geometry-affecting intent (mode, straight flag, endpoints, via points),
 * never on ids, names, days or duration overrides.
 */
export function legRouteKey(
  from: LatLng,
  to: LatLng,
  leg: Pick<Leg, 'mode' | 'via' | 'straight'>,
): string {
  const kind = leg.mode === 'drive' && leg.straight ? 'drive-straight' : leg.mode
  return [kind, point(from), ...leg.via.map(point), point(to)].join(';')
}

/**
 * Duration used by statistics and the ride animation: the user's override when set,
 * otherwise the routed/estimated duration. Undefined while a route is still unknown.
 */
export function effectiveDurationS(
  leg: Pick<Leg, 'durationMin'>,
  route: Pick<LegRoute, 'durationS'> | undefined,
): number | undefined {
  if (leg.durationMin != null) return leg.durationMin * 60
  return route?.durationS
}
